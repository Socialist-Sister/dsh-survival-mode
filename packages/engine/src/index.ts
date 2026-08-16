/**
 * `@dsh-survival/engine`：生存模式的规则引擎插件行。
 *
 * 挂载位置：AGENT PRESET（survival 预设的 isolate realm 组），不触碰宿主
 * composition——引擎的服务消费者全部在预设内部，跨会话的玩家存档通过宿主
 * `storageDomain` 服务持久化（预设消费宿主服务，符合官方平面规则）。
 *
 * 职责：
 *   - 注册 settings 命名空间 `dsh-survival`（难度/节奏/耐久，settings.yaml 可调）
 *   - 提供 `survivalEngine` 服务（状态/合成/吃/睡/配方书，供工具包消费）
 *   - `tools/pre-execute` 作用域瀑布监听：死亡判定、工具门禁（铁镐/望远镜/
 *     红石中继器）、饥饿与昼夜结算、夜晚刷怪——全部硬结算
 *   - `tools/result` 观察：任务完成信号 → 挖矿掉落（原版矿石）+ 经验
 *   - `agent/session-start`：为会话建立世界（复活/继承存档）
 * @module @dsh-survival/engine
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z as zod } from 'zod'
// 事件表增强：tools/pre-execute 等来自 dsh-tools，agent/session-start 来自 dsh-agent，
// session/event 来自 dsh-session
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as game from './game'

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
})

/** 玩家存档的 storage domain（host `storageDomain` 服务）。名须匹配 /^[a-z][a-z0-9_]*$/。 */
const SAVE_SPEC = defineDomain({
  name: 'dsh_survival',
  version: 1,
  global: {
    schema: zod.object({
      xp: zod.number(),
      day: zod.number(),
      deaths: zod.number(),
      respawnBed: zod.boolean(),
      achievements: zod.array(zod.string()),
    }),
    initial: { xp: 0, day: 1, deaths: 0, respawnBed: false, achievements: [] },
  },
  tables: {
    gravestones: domainTable(
      zod.object({
        day: zod.number(),
        cause: zod.string(),
        droppedItems: zod.array(zod.string()),
        droppedXp: zod.number(),
        at: zod.string(),
      }),
    ),
  },
})

/** 提供给 `@dsh-survival/tool-survival` 的服务接口。 */
export interface SurvivalEngineService {
  status(sessionId: string): string
  hud(sessionId: string): string
  eat(sessionId: string, food: string): { ok: boolean; message: string }
  craft(sessionId: string, recipe: string): { ok: boolean; message: string }
  sleep(sessionId: string): { ok: boolean; message: string }
  /** 浏览器状态栏（@dsh-survival/hud）读取的轻量快照。 */
  snapshot(sessionId: string): game.HudSnapshot
}

function sessionIdOf(exec: { agent?: { session?: { id: unknown }; id?: unknown } | null }): string {
  const agent = exec.agent
  if (agent === undefined || agent === null) return ''
  return String(agent.session?.id ?? agent.id ?? '')
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

  // ── 存档：打开 storage domain（宿主服务，可选——缺席时内存态照常可玩）───
  let domain: Domain<typeof SAVE_SPEC> | undefined
  const facility = ctx.get('storageDomain') as DomainFacility | undefined
  if (facility !== undefined) {
    try {
      domain = await facility.open(SAVE_SPEC)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-survival: storage domain open failed (${String(error)}) — 存档不可用，仅内存态`)
    }
  }
  ctx.effect(() => () => {
    void domain?.close().catch(() => {})
  })

  const loadStats = (): game.WorldStats => {
    if (domain === undefined) return { xp: 0, day: 1, deaths: 0, respawnBed: false, achievements: [] }
    try {
      return domain.global.get()
    } catch {
      return { xp: 0, day: 1, deaths: 0, respawnBed: false, achievements: [] }
    }
  }

  const persistStats = async (world: game.World): Promise<void> => {
    if (domain === undefined) return
    try {
      await domain.global.set({
        xp: world.xp,
        day: world.day,
        deaths: world.deaths,
        respawnBed: world.respawnBed,
        achievements: [...world.achievements],
      })
    } catch {
      /* 存档写失败不影响游戏进行 */
    }
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

  const worldFor = (sessionId: string): game.World => {
    let world = worlds.get(sessionId)
    if (world === undefined) {
      world = game.createWorld(sessionId, loadStats())
      worlds.set(sessionId, world)
    }
    return world
  }

  /** 死亡收尾：持久化掉落/墓碑；极限难度删档；向玩家播报死亡。 */
  const kill = async (world: game.World, cause: string): Promise<void> => {
    if (world.dead && world.death !== undefined) return
    game.die(world, cause)
    world.deaths += 1
    if (cfg().difficulty === 'hardcore') {
      try {
        await domain?.global.set({ xp: 0, day: 1, deaths: 0, respawnBed: false, achievements: [] })
      } catch {}
      if (domain !== undefined) {
        try {
          for (const key of domain.table('gravestones').keys()) await domain.table('gravestones').delete(key)
        } catch {}
      }
      notify(world.id, `☠️ ${world.death?.message ?? '你死了'}。极限模式：死亡即删档，世界已归零——写遗言吧。`)
      return
    }
    try {
      if (domain !== undefined) {
        await domain.global.set({
          xp: world.xp,
          day: world.day,
          deaths: world.deaths,
          respawnBed: world.respawnBed,
          achievements: [...world.achievements],
        })
        await domain.table('gravestones').put(`grave-${Date.now()}`, {
          day: world.day,
          cause: world.death?.message ?? '死因不明',
          droppedItems: world.death?.dropped ?? [],
          droppedXp: world.death?.droppedXp ?? 0,
          at: new Date().toISOString(),
        })
      }
    } catch {
      /* 墓碑写失败不影响死亡判定 */
    }
    const dropped = world.death?.dropped.join('、') ?? '空手'
    notify(
      world.id,
      `☠️ ${world.death?.message ?? '你死了'}。掉落：${dropped}；经验 −${world.death?.droppedXp ?? 0}。本会话已死亡——写下遗言吧；新会话将从重生点复活${world.respawnBed ? '，床还在等你' : ''}。`,
    )
  }

  // ── 会话开始：建立世界（复活点继承床，天数/经验/进度随存档延续）────────
  ctx.on('agent/session-start', (payload: any) => {
    try {
      const id = String(payload?.agent?.session?.id ?? payload?.agent?.id ?? '')
      if (id.length > 0) worldFor(id)
    } catch {
      /* 首次接触时惰性建世界兜底 */
    }
  })

  // ── 对话回合：每个用户消息结算回血、昼夜与怪物（纯聊天也过天）───────────
  ctx.on('session/event', (session: any, event: any) => {
    if (event?.type !== 'user/message') return
    // 只有真实用户消息算"对话回合"；引擎播报、插件消息等不推进时间
    if (event?.data?.source?.kind !== 'user') return
    const sessionId = String(session?.id ?? '')
    if (sessionId.length === 0) return
    const world = worlds.get(sessionId) ?? worldFor(sessionId)
    const outcome = game.onTurn(world, cfg())
    if (outcome.cause !== undefined) void kill(world, outcome.cause)
    if (outcome.dayChanged === true) void persistStats(world)
    for (const notice of outcome.notices ?? []) notify(sessionId, notice)
  })

  // ── 工具门禁 + 生存结算（作用域过滤：只拦本预设的会话）──────────────────
  ctx.on('tools/pre-execute', async (exec: any, next: () => Promise<any>) => {
    const sessionId = sessionIdOf(exec)
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
      await kill(world, outcome.cause)
      return { kind: 'deny', reason: game.deathDeny(world, cfg()) }
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
    // 每次挖矿都落盘：经验是硬通货，绝不允许随会话蒸发
    void persistStats(world)
  })

  // ── 会话结束：强制落盘（防止最后一次挖矿/进度没来得及写）──────────────
  ctx.on('session/disposed', (session: any) => {
    const id = String(session?.id ?? '')
    const world = worlds.get(id)
    if (world !== undefined) void persistStats(world)
  })

  // ── 服务 ──────────────────────────────────────────────────────────────────
  ctx.provide('survivalEngine', {
    status: (sessionId: string) => game.formatStatus(worldFor(sessionId), cfg()),
    hud: (sessionId: string) => game.formatHud(worldFor(sessionId), cfg()),
    eat: (sessionId: string, food: string) => game.eat(worldFor(sessionId), food, cfg()),
    craft: (sessionId: string, recipe: string) => {
      const world = worldFor(sessionId)
      const outcome = game.craft(world, recipe, cfg())
      if (outcome.ok) void persistStats(world)
      return outcome
    },
    sleep: (sessionId: string) => {
      const world = worldFor(sessionId)
      const outcome = game.sleep(world, cfg())
      if (outcome.ok) void persistStats(world)
      return outcome
    },
    snapshot: (sessionId: string) => game.snapshot(worldFor(sessionId), cfg()),
  } satisfies SurvivalEngineService)
}
