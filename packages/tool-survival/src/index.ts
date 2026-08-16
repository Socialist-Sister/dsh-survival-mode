/**
 * `@dsh-survival/tool-survival`：生存模式的模型侧工具包。
 *
 * 挂载位置：AGENT PRESET（与引擎同在一个 isolate realm 组，`inject` 消费
 * `survivalEngine` 服务）。注册四个生存工具并渲染 HUD 系统提示区：
 *
 *   - `survival_status`：完整状态（生命/饥饿/背包/门禁/进度/配方书）
 *   - `survival_craft`：按原版配方合成（参数为配方 id）
 *   - `survival_eat`：吃面包回复饥饿
 *   - `survival_sleep`：睡在床上跳过夜晚并设置重生点
 *
 * HUD 通过 `systemPrompt.section` 在每次装配时渲染当前会话的实时状态，
 * 与 @dsh-collaboration/tool-team 的名册区同一机制。
 * @module @dsh-survival/tool-survival
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SurvivalEngineService } from '@dsh-survival/engine'

export const name = 'tool-survival'
export const inject = ['tools', 'survivalEngine'] as const

function sessionIdOf(exec: any): string {
  const agent = exec?.agent
  if (agent === undefined || agent === null) return ''
  return String(agent.session?.id ?? agent.id ?? '')
}

const RECIPE_IDS = 'planks / stick / torch / furnace / smelt-iron / smelt-copper / smelt-stone / bread / iron-pickaxe / stone-sword / iron-sword / diamond-sword / shield / bed / spyglass / redstone-torch / redstone-repeater / anvil / repair-pickaxe / repair-stone-sword / repair-sword / repair-diamond-sword / repair-shield'

export function apply(ctx: any) {
  const engine = ctx.survivalEngine as SurvivalEngineService

  ctx.tools.register(
    defineTool({
      name: 'survival_status',
      description:
        '查看生存模式完整状态：生命与饥饿、世界天数与昼夜、背包材料、物品栏、工具门禁（subagent/web_search/workflow 分别需要什么物品）、进度与完整配方书。接到任务或状态不明时先看这里。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(_args: {}, exec: any) {
        const id = sessionIdOf(exec)
        if (id.length === 0) return '生存模式工具需要在一个会话中调用。'
        return engine.status(id)
      },
      presentCall: () => ({ card: 'generic', title: '⛏️ 生存状态', kind: 'other', rawInput: {} }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'survival_craft',
      description: `按原版 Minecraft 配方合成物品。recipe 为配方 id：${RECIPE_IDS}。材料从挖矿获得（完成任务掉落）。失败会告诉你缺什么。`,
      parameters: {
        recipe: {
          type: 'string',
          required: true,
          description: `配方 id（如 iron-pickaxe / bread / torch / bed）：${RECIPE_IDS}`,
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(args: { recipe: string }, exec: any) {
        const id = sessionIdOf(exec)
        if (id.length === 0) return '生存模式工具需要在一个会话中调用。'
        const outcome = engine.craft(id, args.recipe)
        return outcome.message
      },
      presentCall: (args: any) => ({ card: 'generic', title: `🛠️ 合成 ${args.recipe}`, kind: 'other', rawInput: {} }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'survival_eat',
      description: '吃东西回复饥饿。目前只有面包（小麦×3 合成一个，回复饥饿）。饥饿归零会掉血，饿了记得吃。',
      parameters: {
        food: {
          type: 'string',
          description: '食物种类，目前只支持 bread（默认）。',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(args: { food?: string }, exec: any) {
        const id = sessionIdOf(exec)
        if (id.length === 0) return '生存模式工具需要在一个会话中调用。'
        return engine.eat(id, args.food ?? 'bread').message
      },
      presentCall: (args: any) => ({ card: 'generic', title: `🍞 吃 ${args.food ?? '面包'}`, kind: 'other', rawInput: {} }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'survival_sleep',
      description: '睡在床上：跳过夜晚（夜晚刷怪）并把床设置为重生点（死亡后床保留）。只能在夜晚且有床时使用（羊毛×3+木板×3 合成床）。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(_args: {}, exec: any) {
        const id = sessionIdOf(exec)
        if (id.length === 0) return '生存模式工具需要在一个会话中调用。'
        return engine.sleep(id).message
      },
      presentCall: () => ({ card: 'generic', title: '🛏️ 睡觉', kind: 'other', rawInput: {} }),
    }),
  )

  // ── HUD：系统提示区实时状态（每次装配渲染）────────────────────────────────
  // order 取最大档（远超工具目录 100–199）：HUD 是每回合变化的动态文本，
  // 必须排在系统提示词最末尾——前缀缓存从第一个不同字节开始失效，
  // 放在前部会让后面的工具目录/指令每回合全部 miss。
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    systemPrompt.section({
      name: 'dsh-survival:hud',
      order: 900,
      text: (context: any) => {
        const id = String(context?.agent?.session?.id ?? '')
        if (id.length === 0) return ''
        return engine.hud(id)
      },
    })
  }
}
