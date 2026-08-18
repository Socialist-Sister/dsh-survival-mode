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
import { DEFAULT_EXCLUDES, backupRoot, removeSnapshot, restoreWorkspace, snapshotWorkspace } from './respawn'

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
  const agents = ctx.get('agents') as
    | { get(id: string): { followup(message: unknown): void } | undefined }
    | undefined
  const notify = (sessionId: string, text: string): void => {
    try {
      const agent = agents?.get(sessionId)
      if (agent === undefined) return
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: '@dsh-survival/engine' },
        }),
      )
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
    }
    return world
  }

  /** 死亡收尾：游戏结算 + 顶层会话的文件回退 + 向玩家播报死亡。 */
  const kill = async (world: game.World, cause: string): Promise<string> => {
    if (world.dead && world.death !== undefined) return ''
    game.die(world, cause)
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
    const dropped = world.death?.dropped.join('、') ?? '空手'
    notify(
      world.id,
      `☠️ ${world.death?.message ?? '你死了'}。掉落：${dropped}；经验 −${world.death?.droppedXp ?? 0}。${respawnNote}本会话已死亡——写下遗言吧；每个会话都是独立存档，新会话从第 1 天重新开始。`,
    )
    return respawnNote
  }

  // ── 会话开始：建立世界 + 出生点文件快照（独立存档）──────────────────────
  ctx.on('agent/session-start', (payload: any) => {
    try {
      const agent = payload?.agent as AgentLike | undefined
      const id = remember(agent)
      if (id.length === 0) return
      worldFor(id)
      const meta = metaOf(id)
      if (!meta.topLevel || meta.cwd === undefined || meta.cwd.length === 0) return
      void chain(id, async () => {
        const result = await snapshotWorkspace(meta.cwd as string, backupDirOf(id), excludes())
        if (result.ok) {
          notify(id, `📁 出生点已建立：工作区已备份（${result.files} 个文件）。死亡时文件将回退到此状态；睡过觉后重生点会更新为当前状态。`)
        } else {
          ctx.logger?.warn?.(`dsh-survival: 出生点快照失败 (${result.error ?? '未知'}) — 死亡时将无法回退文件`)
        }
      })
    } catch {
      /* 首次接触时惰性建世界兜底 */
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
    const outcome = game.onTurn(world, cfg())
    if (outcome.cause !== undefined) void kill(world, outcome.cause)
    for (const notice of outcome.notices ?? []) notify(sessionId, notice)
  })

  // ── 工具门禁 + 生存结算（作用域过滤：只拦本预设的会话）──────────────────
  ctx.on('tools/pre-execute', async (exec: any, next: () => Promise<any>) => {
    const sessionId = remember(exec.agent as AgentLike | undefined)
    if (sessionId.length === 0) return next()
    const world = worldFor(sessionId)

    // 免费动作：生存工具、交谈、记账、观察——不耗饥饿也不推进昼夜
    if (game.FREE_TOOLS.has(exec.name) || exec.name.startsWith('survival_')) return next()

    // 死亡：除了生存工具外一律拒绝
    if (world.dead) {
      return { kind: 'deny', reason: game.deathDeny(world, cfg()) }
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
    const outcome = game.settle(world, cfg(), exec.name)
    if (outcome.cause !== undefined) {
      const respawnNote = await kill(world, outcome.cause)
      return { kind: 'deny', reason: game.deathDeny(world, cfg()) + (respawnNote.length > 0 ? `\n${respawnNote}` : '') }
    }
    if (outcome.deny !== undefined) {
      return { kind: 'deny', reason: outcome.deny }
    }
    for (const notice of outcome.notices ?? []) notify(sessionId, notice)
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
      tier = Math.random() < cfg().smallLootChance ? 'small' : undefined
    }
    if (tier === undefined) return

    game.mine(world, tier, cfg())
  })

  // ── 会话结束：清理该会话的文件重生点备份（独立存档，随会话消亡）────────
  ctx.on('session/disposed', (session: any) => {
    const id = String(session?.id ?? '')
    if (id.length === 0) return
    void removeSnapshot(backupDirOf(id)).catch(() => {})
  })

  // ── 服务 ──────────────────────────────────────────────────────────────────
  ctx.provide('survivalEngine', {
    status: (sessionId: string) => game.formatStatus(worldFor(sessionId), cfg()),
    hud: (sessionId: string) => game.formatHud(worldFor(sessionId), cfg()),
    eat: (sessionId: string, food: string) => game.eat(worldFor(sessionId), food, cfg()),
    craft: (sessionId: string, recipe: string) => {
      const world = worldFor(sessionId)
      return game.craft(world, recipe, cfg())
    },
    sleep: async (sessionId: string) => {
      const world = worldFor(sessionId)
      const outcome = game.sleep(world, cfg())
      // 新重生点：睡觉成功即覆盖文件备份（await 完成再返回，保证立即可回退）
      if (outcome.ok) {
        const meta = metaOf(sessionId)
        if (meta.topLevel && meta.cwd !== undefined && meta.cwd.length > 0) {
          const result = await chain(sessionId, () => snapshotWorkspace(meta.cwd as string, backupDirOf(sessionId), excludes()))
          if (result.ok) {
            outcome.message += ` 📁 重生点已更新：工作区备份 ${result.files} 个文件（死亡时文件将回退到此状态）。`
          } else {
            outcome.message += ` ⚠️ 重生点备份失败：${result.error ?? '未知错误'}（死亡时将回退到上一个备份）。`
          }
        }
      }
      return outcome
    },
    snapshot: (sessionId: string) => game.snapshot(worldFor(sessionId), cfg()),
  } satisfies SurvivalEngineService)
}
