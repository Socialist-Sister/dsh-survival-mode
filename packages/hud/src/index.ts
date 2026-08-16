/**
 * `@dsh-survival/hud` (host half): browser status-bar bridge for the survival
 * engine.
 *
 * The engine itself lives inside the survival preset's isolate realm — a realm
 * is invisible to the host, and a `kind: 'direct'` Typert Remote resolves its
 * receiver on the host plane. This row is the sanctioned bridge: a HOST-plane
 * `survivalHud` Remote whose methods read the preset engine through
 * `agentPresets.serviceFor(agent, 'survivalEngine')` (the same pathway the
 * api-proxy uses for preset-provided goals/skills).
 *
 * `capability` gates everything on `composedPreset(agent.ctx) === 'survival'`,
 * so the status bar is invisible in every other mode — this host row never
 * touches non-survival sessions.
 *
 * Mount as a HOST-composition row (cordis.patch.yml insert):
 *
 *   - id: survival-hud
 *     name: '@dsh-survival/hud'
 *
 * @module @dsh-survival/hud
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

export const name = 'survival-hud'

const SESSION_ID_SCHEMA = z.intersection(z.string(), z.unknown())
const CAPABILITY_RESULT_SCHEMA = z.object({ active: z.boolean() })
const STATUS_RESULT_SCHEMA = z.object({
  hp: z.number(),
  maxHp: z.number(),
  hunger: z.number(),
  maxHunger: z.number(),
  day: z.number(),
  night: z.boolean(),
  xp: z.number(),
  dead: z.boolean(),
  deathMessage: z.string(),
})

/** One status-bar snapshot crossing the wire (lossless JSON only). */
export interface HudStatus {
  hp: number
  maxHp: number
  hunger: number
  maxHunger: number
  day: number
  night: boolean
  xp: number
  dead: boolean
  deathMessage: string
}

const EMPTY_STATUS: HudStatus = {
  hp: 0,
  maxHp: 20,
  hunger: 0,
  maxHunger: 20,
  day: 1,
  night: false,
  xp: 0,
  dead: false,
  deathMessage: '',
}

/** 第三方包的 Remote 标记无法被 SRC 扫描，必须显式注册严格描述符。 */
function registerTypertInvocations(ctx: Context) {
  const typert = (ctx as any).typert as
    | {
        register(contribution: unknown): () => void
      }
    | undefined
  if (typert === undefined) return
  const agentParameter = {
    name: 'agent',
    wire: 'agentId',
    source: 'lookup',
    lookup: 'agent',
    codec: {
      mode: 'strict',
      typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
      schema: SESSION_ID_SCHEMA,
    },
  }
  typert.register({
    package: '@dsh-survival/hud',
    face: 'host',
    schemas: [],
    invocations: [
      {
        id: '@dsh-survival/hud#survivalHud/capability',
        service: 'survivalHud',
        namespace: 'survivalHud',
        method: 'capability',
        invocation: { kind: 'direct' },
        scope: { context: 'agent', wire: 'agentId' },
        parameters: [agentParameter],
        result: {
          mode: 'strict',
          typeSymbol: '@dsh-survival/hud#survivalHud/capability:result',
          schema: CAPABILITY_RESULT_SCHEMA,
        },
      },
      {
        id: '@dsh-survival/hud#survivalHud/status',
        service: 'survivalHud',
        namespace: 'survivalHud',
        method: 'status',
        invocation: { kind: 'direct' },
        scope: { context: 'agent', wire: 'agentId' },
        parameters: [agentParameter],
        result: {
          mode: 'strict',
          typeSymbol: '@dsh-survival/hud#survivalHud/status:result',
          schema: STATUS_RESULT_SCHEMA,
        },
      },
    ],
  })
}

export default class SurvivalHudService extends TypertRemoteService {
  static inject = ['agentPresets', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'survivalHud')
    registerTypertInvocations(ctx)
  }

  /** 门禁：只有「生存模式」会话激活状态栏，其他模式永远关闭。 */
  capability(agent: Agent): { active: boolean } {
    let active = false
    try {
      const agentPresets = (this.ctx as any).agentPresets as
        | { composedPreset(agentCtx: unknown): string | undefined }
        | undefined
      active = agentPresets?.composedPreset(agent.ctx) === 'survival'
    } catch {
      /* 预设不可用时保持关闭——绝不误伤其他模式 */
    }
    return { active }
  }

  /** 通过 agentPresets.serviceFor 读取该会话的预设引擎快照。 */
  status(agent: Agent): HudStatus {
    try {
      const agentPresets = (this.ctx as any).agentPresets as
        | { serviceFor(agent: { ctx: Context }, name: string): unknown }
        | undefined
      const engine = agentPresets?.serviceFor(agent, 'survivalEngine') as
        | { snapshot(sessionId: string): HudStatus }
        | undefined
      if (engine === undefined) return EMPTY_STATUS
      const id = String(agent.session?.id ?? agent.id ?? '')
      if (id.length === 0) return EMPTY_STATUS
      return engine.snapshot(id)
    } catch {
      return EMPTY_STATUS
    }
  }
}
