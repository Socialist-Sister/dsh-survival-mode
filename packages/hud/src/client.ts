/**
 * `@dsh-survival/hud` (client half): Minecraft-style status bar, auto-mounted
 * through the package's `dsh.client` declaration.
 *
 * Renders inside the composer dock (`conversation.input.dock`) — a full-width
 * row of its own above the input card. Polls `survivalHud/capability` and
 * `survivalHud/status` every two seconds; the capability gate makes the bar
 * render ONLY in survival-mode sessions (null everywhere else, no impact on
 * other modes).
 *
 * Icons are from OpenMoji (CC BY-SA 4.0, https://openmoji.org) — one uniform
 * 72×72 icon family inlined as data URLs by the build, so every heart /
 * drumstick / sun / moon / star / skull is the same size and style on every
 * platform. See `assets/ATTRIBUTION.md` for provenance and license notes.
 * Semantics match vanilla Minecraft: one full heart = 2 HP, one half heart =
 * 1 HP; one full drumstick = 2 hunger, one half = 1.
 *
 * @module @dsh-survival/hud/client
 */
import { createElement, useEffect, useState } from 'react'
import { z } from 'zod'
import heartSvg from '../assets/red-heart.svg'
import heartEmptySvg from '../assets/black-heart.svg'
import drumSvg from '../assets/poultry-leg.svg'
import sunSvg from '../assets/sun.svg'
import moonSvg from '../assets/crescent-moon.svg'
import starSvg from '../assets/star.svg'
import skullSvg from '../assets/skull.svg'

export const name = 'survival-hud-client'
export const inject = ['slots', 'remote']

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

const CONTRIBUTION = {
  package: '@dsh-survival/hud',
  descriptors: [
    {
      id: '@dsh-survival/hud#survivalHud/capability',
      service: 'survivalHud',
      namespace: 'survivalHud',
      method: 'capability',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            schema: SESSION_ID_SCHEMA,
          },
        },
      ],
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
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            schema: SESSION_ID_SCHEMA,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: '@dsh-survival/hud#survivalHud/status:result',
        schema: STATUS_RESULT_SCHEMA,
      },
    },
  ],
}

interface HudStatus {
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

/** Bridge state shared between apply() and the (per-session) slot entry. */
const runtime: { survivalHud: any } = { survivalHud: undefined }

// ── OpenMoji 图标渲染（同一 72×72 网格家族，尺寸/风格严格一致）─────────────

const PIXELATED = { display: 'block' } as const

function IconImg(props: { src: string; size: number; dim?: boolean }) {
  return createElement('img', {
    src: props.src,
    width: props.size,
    height: props.size,
    alt: '',
    draggable: false,
    style: {
      display: 'block',
      ...(props.dim === true ? { opacity: 0.35, filter: 'grayscale(1)' } : {}),
    },
  })
}

/** 心形槽：满 = 红心；半 = 黑心垫底 + 红心裁左半；空 = 黑心。 */
function HeartSlot(props: { variant: 'full' | 'half' | 'empty'; size: number }) {
  if (props.variant === 'full') return createElement(IconImg, { src: heartSvg, size: props.size })
  if (props.variant === 'empty') return createElement(IconImg, { src: heartEmptySvg, size: props.size, dim: true })
  return createElement(
    'span',
    { style: { position: 'relative', display: 'block', width: props.size, height: props.size } },
    createElement(IconImg, { src: heartEmptySvg, size: props.size, dim: true }),
    createElement('span', { style: { position: 'absolute', inset: 0, clipPath: 'inset(0 50% 0 0)' } }, createElement(IconImg, { src: heartSvg, size: props.size })),
  )
}

/** 鸡腿槽：满 = 鸡腿；半 = 灰鸡腿垫底 + 鸡腿裁左半；空 = 灰鸡腿。 */
function DrumSlot(props: { variant: 'full' | 'half' | 'empty'; size: number }) {
  if (props.variant === 'full') return createElement(IconImg, { src: drumSvg, size: props.size })
  if (props.variant === 'empty') return createElement(IconImg, { src: drumSvg, size: props.size, dim: true })
  return createElement(
    'span',
    { style: { position: 'relative', display: 'block', width: props.size, height: props.size } },
    createElement(IconImg, { src: drumSvg, size: props.size, dim: true }),
    createElement('span', { style: { position: 'absolute', inset: 0, clipPath: 'inset(0 50% 0 0)' } }, createElement(IconImg, { src: drumSvg, size: props.size })),
  )
}

function SlotRow(props: { count: number; full: number; half: number; size: number; render: (variant: 'full' | 'half' | 'empty', index: number) => any }) {
  const icons: any[] = []
  for (let i = 0; i < props.count; i++) {
    const variant: 'full' | 'half' | 'empty' = i < props.full ? 'full' : i === props.full && props.half > 0 ? 'half' : 'empty'
    icons.push(props.render(variant, i))
  }
  return createElement('span', { style: { display: 'flex', alignItems: 'center' } }, icons)
}

const BAR_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '12px',
  padding: '4px 8px',
  fontSize: '13px',
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
} as const

function StatusBar(props: { sessionId: string }) {
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState<HudStatus | null>(null)

  useEffect(() => {
    const sessionId = props.sessionId
    setActive(false)
    setStatus(null)
    let disposed = false
    let timer: number | undefined

    const tick = async () => {
      const remote = runtime.survivalHud
      if (remote === undefined || disposed || sessionId.length === 0) return
      try {
        const capability = await remote.capability(sessionId)
        const isActive = capability.ok === true && capability.value.active === true
        if (disposed) return
        setActive(isActive)
        if (isActive) {
          const result = await remote.status(sessionId)
          if (!disposed && result.ok === true) setStatus(result.value)
        }
      } catch {
        /* RPC 失败保持现状，下一轮重试 */
      }
    }

    void tick()
    timer = window.setInterval(() => {
      void tick()
    }, 2000)
    return () => {
      disposed = true
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [props.sessionId])

  if (!active || status === null) return null
  if (status.dead) {
    return createElement(
      'div',
      {
        style: BAR_STYLE,
        title: status.deathMessage,
      },
      createElement(SlotRow, {
        count: Math.floor(status.maxHp / 2),
        full: 0,
        half: 0,
        size: 15,
        render: (variant, index) => createElement(HeartSlot, { key: `h${index}`, variant, size: 15 }),
      }),
      createElement(SlotRow, {
        count: Math.floor(status.maxHunger / 2),
        full: 0,
        half: 0,
        size: 15,
        render: (variant, index) => createElement(DrumSlot, { key: `d${index}`, variant, size: 15 }),
      }),
      createElement(IconImg, { src: skullSvg, size: 15 }),
      createElement('span', null, `你死了${status.deathMessage.length > 0 ? `——${status.deathMessage}` : '！'}`),
    )
  }
  return createElement(
    'div',
    {
      style: BAR_STYLE,
      title: `${status.hp}/${status.maxHp} 生命 · ${status.hunger}/${status.maxHunger} 饥饿 · ⭐${status.xp}`,
    },
    createElement(SlotRow, {
      count: Math.floor(status.maxHp / 2),
      full: Math.floor(status.hp / 2),
      half: status.hp % 2,
      size: 15,
      render: (variant, index) => createElement(HeartSlot, { key: `h${index}`, variant, size: 15 }),
    }),
    createElement(SlotRow, {
      count: Math.floor(status.maxHunger / 2),
      full: Math.floor(status.hunger / 2),
      half: status.hunger % 2,
      size: 15,
      render: (variant, index) => createElement(DrumSlot, { key: `d${index}`, variant, size: 15 }),
    }),
    createElement(
      'span',
      { style: { display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.95 } },
      status.night
        ? createElement(IconImg, { src: moonSvg, size: 15 })
        : createElement(IconImg, { src: sunSvg, size: 15 }),
      `第${status.day}天`,
      createElement(IconImg, { src: starSvg, size: 15 }),
      String(status.xp),
    ),
  )
}

export async function apply(ctx: any) {
  await ctx.remote.$mount(CONTRIBUTION)
  const survivalHud = ctx.get('remote.survivalHud')
  if (survivalHud === undefined) throw new Error('survival-hud: Remote namespace survivalHud did not mount')
  runtime.survivalHud = survivalHud
  ctx.slots.inject(
    'conversation.input.dock',
    () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'survival-hud',
          order: 5,
        },
        (props: any) => createElement(StatusBar, { sessionId: String(props.sessionId ?? '') }),
      ),
  )
}
