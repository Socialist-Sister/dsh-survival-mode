/**
 * `@dsh-survival/engine`：生存模式的规则引擎插件行。
 *
 * 挂载位置：AGENT PRESET（survival 预设的 isolate realm 组），不触碰宿主
 * composition——引擎的服务消费者全部在预设内部。世界状态（生命/饥饿/天数/
 * 经验/背包）是**会话内存态**：每个会话是一条独立的命、独立存档，不跨会话
 * 持久化；新会话从第 1 天、0 经验、空背包开始。
 *
 * 文件重生点：会话开始时自动把工作区快照到 ${DSH_HOME}/survival-respawns/
 * <sessionId>/（出生点）；每次睡觉覆盖快照（新重生点）；死亡时工作区回退到
 * 最近一次快照（重生点之后的文件改动丢失）。只对顶层会话生效——子代理的
 * 死亡不碰文件。
 *
 * 职责：
 *   - 注册 settings 命名空间 `dsh-survival`（难度/节奏/耐久/快照排除，settings.yaml 可调）
 *   - 提供 `survivalEngine` 服务（状态/合成/吃/睡/配方书，供工具包消费）
 *   - `tools/pre-execute` 作用域瀑布监听：死亡判定、工具门禁（铁镐/望远镜/
 *     红石中继器）、饥饿与昼夜结算、夜晚刷怪——全部硬结算
 *   - `tools/result` 观察：任务完成信号 → 挖矿掉落（原版矿石）+ 经验
 *   - `agent/session-start`：为会话建立世界 + 出生点文件快照
 * @module @dsh-survival/engine
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { access } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
// 事件表增强：tools/pre-execute 等来自 dsh-tools，agent/session-start 来自 dsh-agent，
// session/event 来自 dsh-session
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as game from './game'
import { CONVERSATION_FILE, DEFAULT_EXCLUDES, backupRoot, loadRespawnStateSync, loadWorldSync, removeSnapshot, restoreWorkspace, saveConversation, saveRespawnState, saveWorld, snapshotWorkspace } from './respawn'

export const name = 'survival-engine'
export const inject = [] as const

export const NS = settingsNamespace('dsh-survival')

export interface SurvivalEngineConfig {
  difficulty?: game.Difficulty | null
  dayLengthTurns?: number | null
  mobChance?: number | null
  torchMobFactor?: number | null
  hungerPerAction?: number | null
  heavyHunger?: number | null
  breadHunger?: number | null
  pickaxeDurability?: number | null
  swordDurability?: number | null
  stoneSwordDurability?: number | null
  diamondSwordDurability?: number | null
  shieldDurability?: number | null
  smallLootChance?: number | null
  /** 文件快照排除的目录名（任意深度按 basename 匹配）；空数组 = 全量备份。 */
  respawnExcludes?: string[] | null
}

export const Config: z<SurvivalEngineConfig> = z.object({
  difficulty: z.union(['peaceful', 'easy', 'normal', 'hard', 'hardcore']),
  dayLengthTurns: z.number().step(1).min(4),
  mobChance: z.number().min(0).max(1),
  torchMobFactor: z.number().min(0).max(1),
  hungerPerAction: z.number().min(0),
  heavyHunger: z.number().min(0),
  breadHunger: z.number().min(1),
  pickaxeDurability: z.number().step(1).min(1),
  swordDurability: z.number().step(1).min(1),
  stoneSwordDurability: z.number().step(1).min(1),
  diamondSwordDurability: z.number().step(1).min(1),
  shieldDurability: z.number().step(1).min(1),
  smallLootChance: z.number().min(0).max(1),
  respawnExcludes: z.array(z.string()),
})

/** 每个会话独立存档：出生即全新世界（第 1 天 / 0 经验 / 无成就 / 无床）。 */
const FRESH_STATS: game.WorldStats = { xp: 0, day: 1, deaths: 0, respawnBed: false, achievements: [] }

/** 提供给 `@dsh-survival/tool-survival` 的服务接口。 */
export interface SurvivalEngineService {
  status(sessionId: string): string
  hud(sessionId: string): string
  eat(sessionId: string, food: string): { ok: boolean; message: string }
  craft(sessionId: string, recipe: string): { ok: boolean; message: string }
  sleep(sessionId: string): Promise<{ ok: boolean; message: string }>
  /** 查看（不传 value）或修改（传难度值）本会话难度，不影响其他会话。 */
  difficulty(sessionId: string, value?: string): string
  /** 浏览器状态栏（@dsh-survival/hud）读取的轻量快照。 */
  snapshot(sessionId: string): game.HudSnapshot
}

function sessionIdOf(exec: { agent?: { session?: { id?: unknown }; id?: unknown } | null }): string {
  const agent = exec.agent
  if (agent === undefined || agent === null) return ''
  return String(agent.session?.id ?? agent.id ?? '')
}

// ── 会话元信息（工作目录 / 是否顶层会话）──────────────────────────────────
// 死亡回退需要知道玩家的工作目录与"这是不是玩家本人的会话"。这些信息只存在于
// agent/session-start、tools/pre-execute、session/event 的 agent/session 对象上，
// 服务调用（sleep）只拿得到 sessionId——所以先按会话记录，用到时再读。

interface SessionMeta {
  cwd?: string
  topLevel: boolean
}

type AgentLike = {
  session?: {
    id?: unknown
    header?: { cwd?: string; origin?: string; delegationDepth?: number }
  } | null
  id?: unknown
}

/** 顶层会话（玩家本人）——子代理是分身，其死亡不得回退文件。 */
function isTopLevel(agent: AgentLike | null | undefined): boolean {
  const header = agent?.session?.header
  if (header === undefined) return true // 无 header 信息时按顶层处理（保守可回退）
  return header.origin !== 'subagent' && (header.delegationDepth ?? 0) <= 0
}

/** 会话工作目录（与 dsh-tool-fs 的 sessionCwd 同一通路）。 */
function cwdOf(agent: AgentLike | null | undefined): string | undefined {
  return agent?.session?.header?.cwd
}

export async function apply(ctx: Context, config: SurvivalEngineConfig) {
  // ── settings：组合配置为 base 层，用户可在 settings.yaml 覆盖 ─────────────
  let source = (): SurvivalEngineConfig => config ?? {}
  const settings = ctx.get('settings')
  if (settings !== undefined) {
    try {
      installSettingsSection(ctx, NS, Config, config ?? {}, {
        setSource: (next) => {
          source = next
        },
        onChange: () => {},
      })
    } catch {
      // 命名空间已被占用（并发会话/验证残留的 standing generation）时，
      // 退化为直接读取：settings.yaml 的配置仍然生效，只是失去实时监听。
      try {
        const value = (settings as { get(ns: typeof NS): unknown }).get(NS)
        if (value !== undefined && value !== null && typeof value === 'object') {
          const resolved = value as SurvivalEngineConfig
          source = () => resolved
        }
      } catch {
        /* settings 完全不可用时保持组合配置 */
      }
    }
  }
  const cfg = (): game.SurvivalConfig => {
    const raw = source()
    const merged: game.SurvivalConfig = { ...game.DEFAULT_CONFIG }
    for (const key of Object.keys(game.DEFAULT_CONFIG) as (keyof game.SurvivalConfig)[]) {
      const value = raw[key]
      if (value !== null && value !== undefined) {
        ;(merged as unknown as Record<string, unknown>)[key] = value
      }
    }
    return merged
  }
  /** 会话级配置：难度允许按会话覆盖（survival_difficulty），其余字段取全局。 */
  const cfgFor = (world: game.World): game.SurvivalConfig => {
    const base = cfg()
    if (world.difficulty === undefined || world.difficulty === base.difficulty) return base
    return { ...base, difficulty: world.difficulty }
  }
  /** 快照排除目录（settings 覆盖默认）。 */
  const excludes = (): string[] => {
    const value = source().respawnExcludes
    return value === null || value === undefined ? DEFAULT_EXCLUDES : value
  }

  // ── 文件重生点：备份根目录（${DSH_HOME}/survival-respawns/）──────────────
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const backupDirOf = (sessionId: string): string => join(backupRoot(dshHome), sessionId)

  // 每个会话一条快照 promise 链：出生快照与睡觉快照串行执行，防竞争
  const chains = new Map<string, Promise<unknown>>()
  const chain = <T>(sessionId: string, task: () => Promise<T>): Promise<T> => {
    const prev = chains.get(sessionId) ?? Promise.resolve()
    const next = prev.then(task, task) as Promise<T>
    chains.set(sessionId, next.catch(() => {}))
    return next
  }

  // ── 跃迁播报：把状态变化推成一条插件来源的用户消息（玩家可见，不推进时间）
  // urgent（重要状态）走 steer 插队：下一个 step 边界立即送达；
  // 普通播报走 followup 排队：不打断 agent 正在进行的工具链。
  const agents = ctx.get('agents') as
    | {
        get(id: string): {
          followup(message: unknown): void
          steer(message: unknown): void
          session?: unknown
        } | undefined
      }
    | undefined
  const notify = (sessionId: string, text: string, urgent = false): void => {
    try {
      const agent = agents?.get(sessionId)
      if (agent === undefined) return
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: '@dsh-survival/engine' },
      })
      if (urgent) agent.steer(message)
      else agent.followup(message)
    } catch {
      /* 播报失败不影响游戏进行 */
    }
  }

  // ── 世界表：每个会话（玩家）一条命，子代理也各自结算 ────────────────────
  const worlds = new Map<string, game.World>()
  const metas = new Map<string, SessionMeta>()

  const remember = (agent: AgentLike | null | undefined): string => {
    const id = String(agent?.session?.id ?? agent?.id ?? '')
    if (id.length === 0) return ''
    if (!metas.has(id)) {
      metas.set(id, { cwd: cwdOf(agent), topLevel: isTopLevel(agent) })
    }
    return id
  }

  const metaOf = (sessionId: string): SessionMeta => metas.get(sessionId) ?? { topLevel: true }

  const worldFor = (sessionId: string): game.World => {
    let world = worlds.get(sessionId)
    if (world === undefined) {
      world = game.createWorld(sessionId, FRESH_STATS)
      worlds.set(sessionId, world)
      // 同会话重启恢复：world.json 随文件重生点一起落盘（独立存档跟随会话 id，
      // 新会话仍从零开始；world.json 随备份目录在会话结束时清理）
      const meta = metaOf(sessionId)
      if (meta.topLevel && meta.cwd !== undefined && meta.cwd.length > 0) {
        const loaded = loadWorldSync<Partial<game.World>>(backupDirOf(sessionId))
        if (loaded !== undefined && typeof loaded === 'object') {
          Object.assign(world, loaded)
          if (!world.dead) {
            game.pushLog(world, '📂 世界已恢复：重启前的生命/饥饿/天数/经验/背包已加载。')
          }
        }
      }
    }
    return world
  }

  /** 世界状态落盘（world.json）：状态变更后调用；只对顶层会话生效。 */
  const persistWorld = (sessionId: string, world: game.World): Promise<void> => {
    const meta = metaOf(sessionId)
    if (!meta.topLevel) return Promise.resolve()
    return chain(sessionId, async () => {
      await saveWorld(backupDirOf(sessionId), world)
    })
  }

  // ── 对话摘要：从会话事件流提取最近的真实对话（重生点 = 文件 + 对话）────
  const extractText = (content: unknown): string => {
    try {
      if (!Array.isArray(content)) return ''
      const parts: string[] = []
      for (const block of content) {
        if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
          const text = (block as { text?: unknown }).text
          if (typeof text === 'string') parts.push(text)
        }
      }
      return parts.join('\n').trim()
    } catch {
      return ''
    }
  }
  const conversationMarkdown = (session: any): string => {
    try {
      const events = session?.events as
        | { type: string; data: { content?: unknown; source?: { kind?: string } } }[]
        | undefined
      if (!Array.isArray(events)) return ''
      const lines: string[] = []
      for (const event of events) {
        if (event.type === 'user/message') {
          const sourceKind = event.data?.source?.kind
          if (sourceKind !== undefined && sourceKind !== 'user') continue // 只保留真实用户消息
          const text = extractText(event.data?.content)
          if (text.length > 0) lines.push(`👤 ${text}`)
        } else if (event.type === 'assistant/message') {
          const text = extractText(event.data?.content)
          if (text.length > 0) lines.push(`🤖 ${text}`)
        }
      }
      const recent = lines.slice(-60) // 最近 60 条消息（约一个会话的近期上下文）
      if (recent.length === 0) return ''
      return ['# 重生点对话摘要', '', `> 存档于 ${new Date().toISOString()}，共提取最近 ${recent.length} 条消息。`, '', ...recent, ''].join('\n')
    } catch {
      return ''
    }
  }

  /** 设置重生点：备份工作区文件 + 导出对话摘要 + 世界状态（白天休息与夜晚睡觉共用）。
   *  注意顺序：snapshotWorkspace 会清空备份目录重建，conversation.md / world.json
   *  必须在快照之后写入。 */
  const backupRespawn = async (sessionId: string, cwd: string, world: game.World, session: any): Promise<string> => {
    const backupDir = backupDirOf(sessionId)
    const result = await chain(sessionId, async () => {
      const snap = await snapshotWorkspace(cwd, backupDir, excludes())
      if (snap.ok) {
        await saveConversation(backupDir, conversationMarkdown(session))
        await saveWorld(backupDir, world)
        await saveRespawnState(backupDir, game.respawnSnapshotOf(world))
      }
      return snap
    })
    if (result.ok) {
      return `📁 重生点已更新：工作区备份 ${result.files} 个文件 + 对话摘要（${CONVERSATION_FILE}）+ 世界状态（world.json）+ 重生点状态（respawn.json）。死亡时文件与状态将回退到此，重启也会恢复进度。`
    }
    return `⚠️ 重生点备份失败：${result.error ?? '未知错误'}（死亡时将回退到上一个备份）。`
  }

  /**
   * 死亡收尾：
   * - hardcore：删档（die → 遗言 → 会话终结，新会话是全新世界）
   * - 其他难度：软回退——文件回退到最近备份 + 世界状态恢复到重生点时刻
   *   （生命/饱食/时间/经验/背包），成就保留，会话继续。
   */
  const kill = async (world: game.World, cause: string): Promise<string> => {
    if (world.dead && world.death !== undefined) return ''
    const hardcore = cfgFor(world).difficulty === 'hardcore'
    if (hardcore) game.die(world, cause)
    world.deaths += 1
    // 文件回退（只对顶层会话；失败不阻断死亡结算，但如实播报）
    let respawnNote = ''
    const meta = metaOf(world.id)
    if (meta.topLevel) {
      const cwd = meta.cwd
      if (cwd !== undefined && cwd.length > 0) {
        const result = await chain(world.id, () => restoreWorkspace(cwd, backupDirOf(world.id), excludes()))
        if (result.ok) {
          respawnNote = `📁 文件已回退到${world.respawnBed ? '重生点' : '出生点'}：恢复 ${result.restored} 个文件，删除重生点之后新建的 ${result.deleted} 个文件。`
        } else {
          respawnNote = `⚠️ 文件回退失败：${result.error ?? '未知错误'}（游戏状态不受影响）。`
        }
      } else {
        respawnNote = '⚠️ 本会话没有工作目录，文件无法回退。'
      }
    }
    if (hardcore) {
      const dropped = world.death?.dropped.join('、') ?? '空手'
      // 死亡状态落盘（重启后恢复的会话仍是死亡状态，不会"复活"）
      await persistWorld(world.id, world)
      notify(
        world.id,
        `☠️ ${world.death?.message ?? '你死了'}。掉落：${dropped}；经验 −${world.death?.droppedXp ?? 0}。${respawnNote}（极限模式：死亡即删档）本会话已死亡——写下遗言吧；新会话是全新世界，从第 1 天重新开始。`,
        true,
      )
      return respawnNote
    }
    // ── 软回退：状态恢复到重生点时刻（respawn.json），会话继续 ──────────
    const snapshot = loadRespawnStateSync<game.RespawnSnapshot>(backupDirOf(world.id))
    if (snapshot !== undefined) {
      // 丢失清单（回退前对比）：重生点之后获得的物品/材料/经验
      const lost: string[] = []
      for (const [id, amount] of Object.entries(world.items) as [game.ItemId, number][]) {
        const snap = snapshot.items?.[id] ?? 0
        if (amount > snap) lost.push(`${game.ITEM_LABELS[id]}×${amount - snap}`)
      }
      for (const [id, amount] of Object.entries(world.materials) as [game.MaterialId, number][]) {
        const snap = snapshot.materials?.[id] ?? 0
        if (amount > snap) lost.push(`${game.MATERIAL_LABELS[id]}×${amount - snap}`)
      }
      const lostXp = Math.max(0, world.xp - snapshot.xp)
      game.revive(world, snapshot)
      const lostLine = lost.length > 0 ? `，丢失：${lost.join('、')}` : ''
      const xpLine = lostXp > 0 ? `、经验 ${lostXp}` : ''
      respawnNote += ` 💫 状态已回退到重生点：生命/饱食/时间/经验/背包恢复${lostLine}${xpLine}（成就保留）。`
    } else {
      respawnNote += ' ⚠️ 没有重生点状态（respawn.json）——状态无法回退，仅文件回退。'
    }
    await persistWorld(world.id, world)
    notify(world.id, `☠️ 你${cause}！${respawnNote}继续冒险吧——重生点之后的进展已丢失，但世界还在。`, true)
    return respawnNote
  }

  /**
   * 开局难度询问：新会话（未设置过会话难度）启动时弹出 GUI 问题，
   * 让玩家直接选择本会话难度；无 UI provider / 未作答时静默回退全局难度。
   */
  /**
   * 开局难度询问：新会话（未设置过会话难度）启动时弹出 GUI 问题，
   * 让玩家直接选择本会话难度；无 UI provider / 未作答时静默回退全局难度。
   * agent 必须传 live 实例——web provider 要求 agent-owned session（ASK_MISSING_AGENT）。
   */
  const askDifficulty = async (sessionId: string, world: game.World, agent: unknown): Promise<void> => {
    try {
      const questions = ctx.get('userQuestions') as
        | {
            ask(request: {
              agent?: unknown
              questions: {
                id: string
                header?: string
                question: string
                detail?: string
                options?: { label: string; description?: string }[]
              }[]
            }): Promise<{ answers: { id: string; selected: string[] }[] }>
          }
        | undefined
      if (questions === undefined) {
        ctx.logger?.info?.(`dsh-survival: userQuestions 服务不可用，跳过开局难度询问（会话 ${sessionId}）`)
        return
      }
      const labels: Record<string, string> = {
        peaceful: 'peaceful 和平',
        easy: 'easy 简单',
        normal: 'normal 普通',
        hard: 'hard 困难',
        hardcore: 'hardcore 极限',
      }
      const answer = await questions.ask({
        agent,
        questions: [
          {
            id: 'difficulty',
            header: '🎚️ 选择本会话难度',
            question: '这个会话用哪个难度？',
            options: [
              { label: 'peaceful', description: '和平：不刷怪；饥饿不掉血；无条件回血' },
              { label: 'easy', description: '简单：刷怪概率 ×0.5；怪物伤害减半（最低 1）' },
              { label: 'normal', description: '普通：默认概率与伤害（推荐）' },
              { label: 'hard', description: '困难：刷怪概率 ×1.5；怪物伤害 ×2' },
              { label: 'hardcore', description: '极限：同困难 + 死亡即删档（会话终结，遗言收场）' },
            ],
          },
        ],
      })
      const selected = answer.answers?.[0]?.selected?.[0]
      if (selected !== undefined && (game.DIFFICULTIES as readonly string[]).includes(selected)) {
        world.difficulty = selected as game.Difficulty
        await persistWorld(sessionId, world)
        const note = selected === 'hardcore' ? '死亡即删档——小心！' : '死亡为软回退'
        notify(sessionId, `🎚️ 本会话难度：${labels[selected]}（${note}）——随时可用 survival_difficulty 修改。`, true)
      } else {
        ctx.logger?.info?.(`dsh-survival: 开局难度询问未获有效选择（会话 ${sessionId}），沿用全局难度`)
      }
    } catch (error) {
      // 无 UI provider / 用户未作答 / agent 校验失败：沿用全局难度，并如实播报
      ctx.logger?.warn?.(`dsh-survival: 开局难度询问失败（会话 ${sessionId}）: ${String(error)}`)
      try {
        notify(sessionId, `⚠️ 开局难度询问失败（${String(error)}）——本会话沿用全局难度，可用 survival_difficulty 手动设置。`, true)
      } catch {
        /* 播报失败不影响 */
      }
    }
  }

  /**
   * 首次接触兜底：无论 agent/session-start 是否到达，第一次工具调用时
   * 都确保（1）出生点快照存在（否则死亡时文件无法回退）、（2）难度询问已发起。
   * 每个会话只执行一次。
   */
  const firstContacts = new Set<string>()
  const ensureFirstContact = (sessionId: string, world: game.World): void => {
    if (firstContacts.has(sessionId)) return
    const meta = metaOf(sessionId)
    if (!meta.topLevel) return
    firstContacts.add(sessionId)
    ctx.logger?.info?.(`dsh-survival: 首次接触会话 ${sessionId}（cwd=${meta.cwd ?? '无'}，难度=${world.difficulty ?? '未设置（将询问）'}）`)
    // agent 必须是 registry 的 live 实例（web userQuestions provider 要求 agent-owned session）
    const agent = agents?.get(sessionId)
    if (world.difficulty === undefined) void askDifficulty(sessionId, world, agent)
    if (meta.cwd === undefined || meta.cwd.length === 0) return
    void chain(sessionId, async () => {
      const backupDir = backupDirOf(sessionId)
      // 已有快照（出生点或重生点写过 manifest）则跳过
      let hasManifest = false
      try {
        await access(join(backupDir, 'manifest.json'))
        hasManifest = true
      } catch {
        hasManifest = false
      }
      if (hasManifest) return
      const session = agents?.get(sessionId)?.session
      const result = await snapshotWorkspace(meta.cwd as string, backupDir, excludes())
      if (result.ok) {
        // 快照会清空备份目录重建：conversation.md / world.json / respawn.json 必须随后写入
        await saveConversation(backupDir, conversationMarkdown(session))
        await saveWorld(backupDir, world)
        await saveRespawnState(backupDir, game.respawnSnapshotOf(world))
        notify(sessionId, `📁 出生点已建立：工作区已备份（${result.files} 个文件）+ 对话摘要 + 世界状态。死亡时文件与状态将回退到此；睡过觉后重生点会更新为当前状态。`, true)
      } else {
        ctx.logger?.warn?.(`dsh-survival: 出生点快照失败 (${result.error ?? '未知'}) — 死亡时将无法回退文件`)
      }
    })
  }

  // ── 会话开始：建立世界（含重启恢复）+ 首次接触兜底（快照 + 难度询问）──
  ctx.on('agent/session-start', (payload: any) => {
    try {
      const agent = payload?.agent as AgentLike | undefined
      const id = remember(agent)
      if (id.length === 0) {
        ctx.logger?.info?.('dsh-survival: agent/session-start 未解析到会话 id')
        return
      }
      ensureFirstContact(id, worldFor(id))
    } catch (error) {
      ctx.logger?.warn?.(`dsh-survival: agent/session-start 处理异常: ${String(error)}`)
    }
  })

  // ── 对话回合：每个用户消息结算回血、昼夜与怪物（纯聊天也过天）───────────
  ctx.on('session/event', (session: any, event: any) => {
    if (event?.type !== 'user/message') return
    // 只有真实用户消息算"对话回合"；引擎播报、插件消息等不推进时间
    if (event?.data?.source?.kind !== 'user') return
    const sessionId = remember({ session })
    if (sessionId.length === 0) return
    const world = worlds.get(sessionId) ?? worldFor(sessionId)
    // 首次接触：用户第一条消息就触发出生点快照与难度询问（session-start 不可靠）
    ensureFirstContact(sessionId, world)
    const outcome = game.onTurn(world, cfgFor(world))
    if (outcome.cause !== undefined) void kill(world, outcome.cause)
    for (const notice of outcome.notices ?? []) notify(sessionId, notice.text, notice.urgent)
    // 回合结算落盘：饥饿/回血/昼夜/怪物/羊毛
    void persistWorld(sessionId, world)
  })

  // ── 工具门禁 + 生存结算（作用域过滤：只拦本预设的会话）──────────────────
  ctx.on('tools/pre-execute', async (exec: any, next: () => Promise<any>) => {
    const sessionId = remember(exec.agent as AgentLike | undefined)
    if (sessionId.length === 0) return next()
    const world = worldFor(sessionId)
    // 首次接触兜底：session-start 若未到达，这里补出生点快照与难度询问
    ensureFirstContact(sessionId, world)

    // 免费动作：生存工具、交谈、记账、观察——不耗饥饿也不推进昼夜
    if (game.FREE_TOOLS.has(exec.name) || exec.name.startsWith('survival_')) return next()

    // 死亡：除了生存工具外一律拒绝
    if (world.dead) {
      return { kind: 'deny', reason: game.deathDeny(world, cfgFor(world)) }
    }

    // 工具门禁：没有对应物品就拒绝（像没有镐子挖不了钻石）
    const gate = game.GATES[exec.name]
    if (gate !== undefined) {
      if ((world.items[gate.item] ?? 0) <= 0) {
        return { kind: 'deny', reason: game.gateDeny(gate) }
      }
      if (!gate.permanent) {
        world.items[gate.item] = (world.items[gate.item] ?? 0) - 1
        game.pushLog(world, `⛏️ ${gate.name} 消耗了 1 点耐久（剩 ${world.items[gate.item]}）。`)
      }
    }

    // 生存结算：饥饿 / 怪物（昼夜由对话回合驱动，见 session/event 监听）
    const outcome = game.settle(world, cfgFor(world), exec.name)
    if (outcome.cause !== undefined) {
      const respawnNote = await kill(world, outcome.cause)
      // hardcore：会话终结，拒绝本次调用；普通难度：软回退后照常放行
      if (world.dead) {
        return { kind: 'deny', reason: game.deathDeny(world, cfgFor(world)) + (respawnNote.length > 0 ? `\n${respawnNote}` : '') }
      }
      return next()
    }
    if (outcome.deny !== undefined) {
      return { kind: 'deny', reason: outcome.deny }
    }
    for (const notice of outcome.notices ?? []) notify(sessionId, notice.text, notice.urgent)
    // 工具结算落盘：饥饿/怪物/门禁耐久
    void persistWorld(sessionId, world)
    return next()
  })

  // ── 挖矿：真实任务信号 → 掉落矿石与经验 ─────────────────────────────────
  ctx.on('tools/result', (exec: any, result: any) => {
    const sessionId = sessionIdOf(exec)
    if (sessionId.length === 0 || result?.isError) return
    const world = worlds.get(sessionId)
    if (world === undefined || world.dead) return

    let tier: game.LootTier | undefined
    if (exec.name === 'update_goal' && exec.arguments?.action === 'complete') {
      tier = 'deep'
    } else if (exec.name === 'exit_plan_mode') {
      tier = 'medium'
    } else if (exec.name === 'subagent' || exec.name === 'subagent_fork') {
      tier = 'deeper'
    } else if (exec.name === 'write' || exec.name === 'edit') {
      tier = Math.random() < cfgFor(world).smallLootChance ? 'small' : undefined
    }
    if (tier === undefined) return

    game.mine(world, tier, cfgFor(world))
    // 挖矿落盘：材料与经验是硬通货，绝不随进程蒸发
    void persistWorld(sessionId, world)
  })

  // ── 会话结束：清理该会话的文件重生点备份（独立存档，随会话消亡）────────
  ctx.on('session/disposed', (session: any) => {
    const id = String(session?.id ?? '')
    if (id.length === 0) return
    void removeSnapshot(backupDirOf(id)).catch(() => {})
  })

  // ── 服务 ──────────────────────────────────────────────────────────────────
  ctx.provide('survivalEngine', {
    status: (sessionId: string) => {
      const world = worldFor(sessionId)
      return game.formatStatus(world, cfgFor(world))
    },
    hud: (sessionId: string) => {
      const world = worldFor(sessionId)
      return game.formatHud(world, cfgFor(world))
    },
    eat: (sessionId: string, food: string) => {
      const world = worldFor(sessionId)
      const outcome = game.eat(world, food, cfgFor(world))
      if (outcome.ok) void persistWorld(sessionId, world)
      return outcome
    },
    craft: (sessionId: string, recipe: string) => {
      const world = worldFor(sessionId)
      const outcome = game.craft(world, recipe, cfgFor(world))
      if (outcome.ok) void persistWorld(sessionId, world)
      return outcome
    },
    sleep: async (sessionId: string) => {
      const world = worldFor(sessionId)
      const effective = cfgFor(world)
      // 夜晚 + 有床 = 睡觉（跳过夜晚 + 成就）；白天 + 有床 = 休息（只更新重生点备份）
      const outcome = game.isNight(world, effective)
        ? game.sleep(world, effective)
        : (world.items.bed ?? 0) > 0
          ? game.rest(world, effective)
          : game.sleep(world, effective) // 无床：复用"你没有床"的错误
      // 设置重生点：备份工作区文件 + 对话摘要 + 世界状态（await 完成再返回，保证立即可回退）
      if (outcome.ok) {
        const meta = metaOf(sessionId)
        if (meta.topLevel && meta.cwd !== undefined && meta.cwd.length > 0) {
          const session = agents?.get(sessionId)?.session as any
          outcome.message += ` ${await backupRespawn(sessionId, meta.cwd as string, world, session)}`
        }
        void persistWorld(sessionId, world)
      }
      return outcome
    },
    snapshot: (sessionId: string) => {
      const world = worldFor(sessionId)
      return game.snapshot(world, cfgFor(world))
    },
    difficulty: (sessionId: string, value?: string) => {
      const world = worldFor(sessionId)
      if (value === undefined || value === null || value === '') {
        const current = cfgFor(world).difficulty
        return `当前难度：${current}（${world.difficulty !== undefined && world.difficulty !== current ? '本会话覆盖' : world.difficulty !== undefined ? '本会话设置' : '全局 settings'}）。可用 survival_difficulty 修改本会话难度。`
      }
      if (!(game.DIFFICULTIES as readonly string[]).includes(value)) {
        return `无效难度「${value}」——可选：${(game.DIFFICULTIES as readonly string[]).join(' / ')}。`
      }
      world.difficulty = value as game.Difficulty
      void persistWorld(sessionId, world)
      const note = value === 'hardcore' ? '（死亡即删档：本会话死亡将直接终结！）' : '（死亡为软回退：文件与状态回退到重生点，会话继续）'
      return `✅ 本会话难度已改为 ${value}${note}（仅本会话生效，其他会话与全局 settings 不受影响）。`
    },
  } satisfies SurvivalEngineService)
}
