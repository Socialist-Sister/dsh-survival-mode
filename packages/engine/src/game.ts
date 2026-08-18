/**
 * `@dsh-survival/engine` 的游戏规则层：纯函数 + 纯数据，不依赖 Cordis。
 *
 * 所有概念对齐原版 Minecraft 生存模式：
 *   - 生命 ❤️×20（10 颗心，一颗满心 2 血、半颗心 1 血）、饥饿 🍗×20：
 *     行动消耗饥饿，饥饿归零掉血（和平难度除外）；
 *     饱食度 ≥17 时每回合自然再生 1❤️（原版规则），和平难度无条件回血
 *   - 挖矿 = 完成任务，掉落原版矿石；熔炉熔炼；原版配方合成
 *   - 昼夜 = 对话回合计数（用户消息推进，纯聊天也过天）；夜晚刷怪
 *     （僵尸/骷髅/苦力怕/蜘蛛）
 *   - 火把防刷怪、床跳过夜晚并设置重生点、盾牌格挡、铁剑反击
 *   - 死亡 = 原版死亡信息 + 掉落全部背包与半数经验；会话随即终结
 *   - 每个会话独立存档：世界状态不跨会话，新会话从第 1 天重新开始；
 *     文件重生点（工作区快照/回退）由引擎在 respawn.ts 层实现
 *   - 进度（成就）用原版名称：钻石！/ 铁器时代 / 甜甜的梦 / 怪猎手
 * @module @dsh-survival/engine/game
 */

// ── 基础常量 ────────────────────────────────────────────────────────────────

/** 生命值上限：原版 20 血 = 10 颗心（一颗满心 2 血、半颗心 1 血）。 */
export const MAX_HP = 20
export const MAX_HUNGER = 20

export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard' | 'hardcore'

export interface SurvivalConfig {
  difficulty: Difficulty
  /** 一天包含的对话回合数（用户消息计数），默认 8，最后 1/3 为夜晚。 */
  dayLengthTurns: number
  /** 夜晚每个动作（对话回合或工具调用）刷怪的基础概率。 */
  mobChance: number
  /** 持有火把时刷怪概率的倍率（光照压制，非免疫；0 = 完全防刷怪）。 */
  torchMobFactor: number
  /** 普通工具调用的饥饿消耗。 */
  hungerPerAction: number
  /** 重型工具（web/subagent/workflow）的饥饿消耗。 */
  heavyHunger: number
  /** 面包回复的饥饿值（原版 +5，平衡上调至 +8 让食物链净收益转正）。 */
  breadHunger: number
  /** 铁镐耐久（修复量为其一半）。 */
  pickaxeDurability: number
  /** 铁剑耐久（修复量为其一半）。 */
  swordDurability: number
  /** 石剑耐久（修复量为其一半）。 */
  stoneSwordDurability: number
  /** 钻石剑耐久（修复量为其一半）。 */
  diamondSwordDurability: number
  /** 盾牌耐久（修复量为其一半）。 */
  shieldDurability: number
  /** 写文件触发小矿的概率。 */
  smallLootChance: number
}

export const DEFAULT_CONFIG: SurvivalConfig = {
  difficulty: 'normal',
  dayLengthTurns: 8,
  mobChance: 0.3,
  torchMobFactor: 0.8,
  hungerPerAction: 1,
  heavyHunger: 1,
  breadHunger: 8,
  pickaxeDurability: 120,
  swordDurability: 100,
  stoneSwordDurability: 50,
  diamondSwordDurability: 200,
  shieldDurability: 120,
  smallLootChance: 0.7,
}

// ── 材料与物品 ──────────────────────────────────────────────────────────────

export type MaterialId =
  | 'cobble' | 'coal' | 'wood' | 'wheat' | 'wool'
  | 'iron-ore' | 'copper-ore'
  | 'iron' | 'copper' | 'stone' | 'plank' | 'stick'
  | 'redstone' | 'redstone-torch'
  | 'diamond' | 'amethyst'

export type ItemId =
  | 'bread' | 'torch' | 'furnace' | 'anvil'
  | 'iron-pickaxe' | 'iron-sword' | 'stone-sword' | 'diamond-sword' | 'shield'
  | 'spyglass' | 'redstone-repeater' | 'bed'

export const MATERIAL_LABELS: Record<MaterialId, string> = {
  cobble: '圆石', coal: '煤', wood: '木头', wheat: '小麦', wool: '羊毛',
  'iron-ore': '铁矿石', 'copper-ore': '铜矿石',
  iron: '铁锭', copper: '铜锭', stone: '石头', plank: '木板', stick: '木棍',
  redstone: '红石粉', 'redstone-torch': '红石火把',
  diamond: '钻石', amethyst: '紫水晶碎片',
}

export const ITEM_LABELS: Record<ItemId, string> = {
  bread: '面包', torch: '火把', furnace: '熔炉', anvil: '铁砧',
  'iron-pickaxe': '铁镐', 'iron-sword': '铁剑', 'stone-sword': '石剑', 'diamond-sword': '钻石剑', shield: '盾牌',
  spyglass: '望远镜', 'redstone-repeater': '红石中继器', bed: '床',
}

/** 有耐久值的物品：耐久池模型（可多次合成叠加）。 */
export const TOOL_DURABILITY: Partial<Record<ItemId, 'pickaxeDurability' | 'stoneSwordDurability' | 'swordDurability' | 'diamondSwordDurability' | 'shieldDurability'>> = {
  'iron-pickaxe': 'pickaxeDurability',
  'stone-sword': 'stoneSwordDurability',
  'iron-sword': 'swordDurability',
  'diamond-sword': 'diamondSwordDurability',
  shield: 'shieldDurability',
}

// ── 配方（全部为原版配方）───────────────────────────────────────────────────

export interface Recipe {
  id: string
  name: string
  costs: Partial<Record<MaterialId, number>>
  /** 需要的物品（如熔炉/铁砧），没有则合成失败。 */
  needs?: ItemId[]
  produces: MaterialId | ItemId
  amount: number
  note: string
  /** 经验消耗（铁砧修复）。 */
  xpCost?: number
  /** 铁砧修复目标：工具 + 其耐久设定键；恢复量 = 耐久上限的一半。 */
  repair?: { tool: ItemId; max: 'pickaxeDurability' | 'stoneSwordDurability' | 'swordDurability' | 'diamondSwordDurability' | 'shieldDurability' }
}

export const RECIPES: Recipe[] = [
  { id: 'planks', name: '木板', costs: { wood: 1 }, produces: 'plank', amount: 4, note: '基础建材。' },
  { id: 'stick', name: '木棍', costs: { plank: 2 }, produces: 'stick', amount: 4, note: '工具手柄。' },
  { id: 'torch', name: '火把', costs: { coal: 1, stick: 1 }, produces: 'torch', amount: 1, note: '照明压制刷怪：持有后夜晚刷怪概率 ×0.8（不是免疫）。' },
  { id: 'furnace', name: '熔炉', costs: { cobble: 8 }, produces: 'furnace', amount: 1, note: '解锁熔炼配方。' },
  { id: 'smelt-iron', name: '熔炼铁锭', costs: { 'iron-ore': 1, coal: 1 }, needs: ['furnace'], produces: 'iron', amount: 1, note: '铁镐/铁剑/盾牌的原料。' },
  { id: 'smelt-copper', name: '熔炼铜锭', costs: { 'copper-ore': 1, coal: 1 }, needs: ['furnace'], produces: 'copper', amount: 1, note: '望远镜的原料。' },
  { id: 'smelt-stone', name: '烧制石头', costs: { cobble: 1, coal: 1 }, needs: ['furnace'], produces: 'stone', amount: 1, note: '红石中继器的原料。' },
  { id: 'bread', name: '面包', costs: { wheat: 3 }, produces: 'bread', amount: 1, note: '食用回复饥饿。' },
  { id: 'iron-pickaxe', name: '铁镐', costs: { iron: 3, stick: 2 }, produces: 'iron-pickaxe', amount: 1, note: '解锁 subagent（深挖），每次使用消耗耐久。' },
  { id: 'stone-sword', name: '石剑', costs: { cobble: 2, stick: 1 }, produces: 'stone-sword', amount: 1, note: '入门剑：自动击退率 40%，得少量经验。' },
  { id: 'iron-sword', name: '铁剑', costs: { iron: 2, stick: 1 }, produces: 'iron-sword', amount: 1, note: '自动击退夜间怪物（60%），得经验。' },
  { id: 'diamond-sword', name: '钻石剑', costs: { diamond: 2, stick: 1 }, produces: 'diamond-sword', amount: 1, note: '更锋利的剑：自动击退率 90%，得更多经验；与铁剑并存时优先使用。' },
  { id: 'shield', name: '盾牌', costs: { plank: 6, iron: 1 }, produces: 'shield', amount: 1, note: '概率格挡怪物伤害。' },
  { id: 'bed', name: '床', costs: { wool: 3, plank: 3 }, produces: 'bed', amount: 1, note: '睡觉跳过夜晚 + 设置重生点。' },
  { id: 'spyglass', name: '望远镜', costs: { amethyst: 1, copper: 2 }, produces: 'spyglass', amount: 1, note: '解锁 web_search（远望），永久。' },
  { id: 'redstone-torch', name: '红石火把', costs: { redstone: 1, stick: 1 }, produces: 'redstone-torch', amount: 1, note: '红石电路组件。' },
  { id: 'redstone-repeater', name: '红石中继器', costs: { redstone: 1, 'redstone-torch': 2, stone: 3 }, produces: 'redstone-repeater', amount: 1, note: '解锁 workflow（自动化），永久。' },
  { id: 'anvil', name: '铁砧', costs: { iron: 12 }, produces: 'anvil', amount: 1, note: '解锁铁砧修复：花经验与材料修补工具耐久（原版需 31 锭，为节奏简化为 12）。' },
  { id: 'repair-pickaxe', name: '修复铁镐', costs: { iron: 1 }, needs: ['anvil'], produces: 'iron-pickaxe', amount: 0, xpCost: 10, repair: { tool: 'iron-pickaxe', max: 'pickaxeDurability' }, note: '消耗 10 经验 + 铁锭×1，恢复一半耐久。' },
  { id: 'repair-sword', name: '修复铁剑', costs: { iron: 1 }, needs: ['anvil'], produces: 'iron-sword', amount: 0, xpCost: 10, repair: { tool: 'iron-sword', max: 'swordDurability' }, note: '消耗 10 经验 + 铁锭×1，恢复一半耐久。' },
  { id: 'repair-stone-sword', name: '修复石剑', costs: { cobble: 1 }, needs: ['anvil'], produces: 'stone-sword', amount: 0, xpCost: 5, repair: { tool: 'stone-sword', max: 'stoneSwordDurability' }, note: '消耗 5 经验 + 圆石×1，恢复一半耐久。' },
  { id: 'repair-diamond-sword', name: '修复钻石剑', costs: { diamond: 1 }, needs: ['anvil'], produces: 'diamond-sword', amount: 0, xpCost: 10, repair: { tool: 'diamond-sword', max: 'diamondSwordDurability' }, note: '消耗 10 经验 + 钻石×1，恢复一半耐久。' },
  { id: 'repair-shield', name: '修复盾牌', costs: { plank: 1 }, needs: ['anvil'], produces: 'shield', amount: 0, xpCost: 10, repair: { tool: 'shield', max: 'shieldDurability' }, note: '消耗 10 经验 + 木板×1，恢复一半耐久。' },
]

// ── 工具门禁 ────────────────────────────────────────────────────────────────

export interface Gate {
  item: ItemId
  name: string
  /** true = 永久解锁（原版无耐久物品）；false = 每次使用消耗耐久。 */
  permanent: boolean
  deny: string
}

/** 合成即解锁的能力公告（玩家可感知的进度感）。 */
export const UNLOCK_ANNOUNCEMENTS: Partial<Record<ItemId, string>> = {
  'iron-pickaxe': '⛏️ 已解锁：subagent / subagent_fork（每次使用消耗 1 耐久）。',
  spyglass: '🔭 已解锁：web_search（永久）。',
  'redstone-repeater': '🔴 已解锁：workflow（永久）。',
}

export const GATES: Record<string, Gate> = {
  subagent: {
    item: 'iron-pickaxe', name: '铁镐', permanent: false,
    deny: '⛏️ 你的手够不到 subagent——需要先合成铁镐（就像没有镐子挖不了钻石）。挖矿攒铁，survival_craft 合成。',
  },
  subagent_fork: {
    item: 'iron-pickaxe', name: '铁镐', permanent: false,
    deny: '⛏️ 你的手够不到 subagent_fork——需要先合成铁镐（就像没有镐子挖不了钻石）。挖矿攒铁，survival_craft 合成。',
  },
  workflow: {
    item: 'redstone-repeater', name: '红石中继器', permanent: true,
    deny: '🔴 红石电路还没接通——需要先合成红石中继器才能使用 workflow（红石粉+红石火把×2+石头×3）。',
  },
  web_search: {
    item: 'spyglass', name: '望远镜', permanent: true,
    deny: '🔭 你看不到远方——需要先合成望远镜才能使用 web_search（紫水晶碎片+铜锭×2）。',
  },
  web_fetch: {
    item: 'spyglass', name: '望远镜', permanent: true,
    deny: '🔭 你看不到远方——需要先合成望远镜才能使用 web_fetch（紫水晶碎片+铜锭×2）。',
  },
}

export function gateDeny(gate: Gate): string {
  return gate.deny
}

/** 重型工具（疾跑：消耗更多饥饿）。 */
export const HEAVY_TOOLS: ReadonlySet<string> = new Set(['web_search', 'web_fetch', 'subagent', 'subagent_fork', 'workflow'])

/** 免费动作（观察/交谈/记账不耗饥饿，也不推进昼夜）。 */
export const FREE_TOOLS: ReadonlySet<string> = new Set([
  'ask_user', 'todo_write', 'create_goal', 'get_goal',
  'skill', 'read', 'glob', 'grep', 'read_image',
  'job_output', 'job_list', 'job_kill', 'list_agents',
])

// ── 怪物（夜晚刷怪，原版生物）───────────────────────────────────────────────

export interface Mob {
  id: string
  name: string
  weight: number
  damage: number
  /** 骷髅：远程射箭，打断本次工具调用。 */
  denyCall: boolean
  /** 原版死亡信息。 */
  death: string
}

export const MOBS: Mob[] = [
  { id: 'zombie', name: '僵尸', weight: 0.35, damage: 2, denyCall: false, death: '被僵尸杀死了' },
  { id: 'skeleton', name: '骷髅', weight: 0.3, damage: 2, denyCall: true, death: '被骷髅射死了' },
  { id: 'creeper', name: '苦力怕', weight: 0.2, damage: 6, denyCall: false, death: '被苦力怕炸死了' },
  { id: 'spider', name: '蜘蛛', weight: 0.15, damage: 2, denyCall: false, death: '被蜘蛛杀死了' },
]

// ── 进度（原版名称）─────────────────────────────────────────────────────────

export const ACHIEVEMENTS: Record<string, { name: string; desc: string }> = {
  diamonds: { name: '钻石！', desc: '挖到第一颗钻石' },
  'acquire-hardware': { name: '铁器时代', desc: '熔炼出第一块铁锭' },
  'sweet-dreams': { name: '甜甜的梦', desc: '在床上睡了一觉' },
  'monster-hunter': { name: '怪猎手', desc: '击退第一只怪物' },
}

// ── 世界状态 ────────────────────────────────────────────────────────────────

/** 世界初始统计（v0.14 起引擎总是传默认值——每个会话独立存档，不再跨会话持久化）。 */
export interface WorldStats {
  xp: number
  day: number
  deaths: number
  respawnBed: boolean
  achievements: string[]
}

export interface Gravestone {
  day: number
  cause: string
  droppedItems: string[]
  droppedXp: number
  at: string
}

export interface DeathInfo {
  message: string
  dropped: string[]
  droppedXp: number
}

export interface World {
  id: string
  hp: number
  hunger: number
  xp: number
  day: number
  deaths: number
  respawnBed: boolean
  /** 今日已过的对话回合数（昼夜推进）。 */
  turnsToday: number
  materials: Partial<Record<MaterialId, number>>
  items: Partial<Record<ItemId, number>>
  achievements: string[]
  dead: boolean
  death?: DeathInfo
  log: string[]
  /** 播报状态位：只在跃迁时提醒一次，恢复后重新武装。 */
  warnedHunger: boolean
  warnedHp: boolean
  nightNotified: boolean
  /** 今夜战报统计（黎明播报并清零）。 */
  nightEncounters: number
  nightRepelled: number
  nightBlocked: number
  nightHurt: number
  nightDamage: number
  /** 中矿每日限挖一次（防止计划退出反复刷矿），记录已挖的天数。 */
  minedMediumDay: number
}

export interface SettleOutcome {
  /** 需要打断本次工具调用的原因（骷髅射箭 / 死亡）。 */
  deny?: string
  /** 本次结算导致的死因（由调用方负责持久化）。 */
  cause?: string
  /** 状态跃迁播报（由调用方投递给玩家）。 */
  notices?: string[]
}

/** 对话回合结算结果（用户消息触发）。 */
export interface TurnOutcome {
  /** 回合结算导致的死因。 */
  cause?: string
  /** 是否跨过了一天（调用方负责持久化天数）。 */
  dayChanged?: boolean
  /** 状态跃迁播报（由调用方投递给玩家）。 */
  notices?: string[]
}

// ── 工具函数 ────────────────────────────────────────────────────────────────

export function createWorld(id: string, stats: WorldStats): World {
  return {
    id,
    hp: MAX_HP,
    hunger: MAX_HUNGER,
    xp: stats.xp,
    day: stats.day,
    deaths: stats.deaths,
    respawnBed: stats.respawnBed,
    turnsToday: 0,
    materials: {},
    items: { ...(stats.respawnBed ? { bed: 1 } : {}) },
    achievements: [...stats.achievements],
    dead: false,
    log: [`🌍 你出生在第 ${stats.day} 天的世界里。${stats.deaths > 0 ? `（你已在这里死了 ${stats.deaths} 次）` : ''}`],
    warnedHunger: false,
    warnedHp: false,
    nightNotified: false,
    nightEncounters: 0,
    nightRepelled: 0,
    nightBlocked: 0,
    nightHurt: 0,
    nightDamage: 0,
    minedMediumDay: 0,
  }
}

export function pushLog(world: World, message: string): void {
  world.log.push(message)
  if (world.log.length > 12) world.log.splice(0, world.log.length - 12)
}

function addMaterial(world: World, id: MaterialId, amount: number): void {
  world.materials[id] = (world.materials[id] ?? 0) + amount
}

function takeMaterial(world: World, id: MaterialId, amount: number): void {
  world.materials[id] = (world.materials[id] ?? 0) - amount
}

function addItem(world: World, id: ItemId, amount: number, cfg: SurvivalConfig): void {
  const durabilityKey = TOOL_DURABILITY[id]
  if (durabilityKey !== undefined) {
    world.items[id] = (world.items[id] ?? 0) + cfg[durabilityKey]
  } else {
    world.items[id] = (world.items[id] ?? 0) + amount
  }
}

export function unlockAchievement(world: World, id: string): boolean {
  if (world.achievements.includes(id)) return false
  world.achievements.push(id)
  const entry = ACHIEVEMENTS[id]
  pushLog(world, `🏆 进度达成：${entry?.name ?? id}！`)
  return true
}

function pickWeighted<T extends { weight: number }>(items: readonly T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let roll = Math.random() * total
  for (const item of items) {
    roll -= item.weight
    if (roll <= 0) return item
  }
  return items[items.length - 1]
}

// ── 昼夜与难度 ──────────────────────────────────────────────────────────────

export function nightLength(cfg: SurvivalConfig): number {
  return Math.max(1, Math.floor(cfg.dayLengthTurns / 3))
}

export function isNight(world: World, cfg: SurvivalConfig): boolean {
  return world.turnsToday >= cfg.dayLengthTurns - nightLength(cfg)
}

function mobChanceFor(cfg: SurvivalConfig): number {
  switch (cfg.difficulty) {
    case 'peaceful': return 0
    case 'easy': return cfg.mobChance * 0.5
    case 'hard':
    case 'hardcore': return Math.min(1, cfg.mobChance * 1.5)
    default: return cfg.mobChance
  }
}

function damageFor(cfg: SurvivalConfig, base: number): number {
  switch (cfg.difficulty) {
    case 'easy': return Math.max(1, Math.ceil(base / 2))
    case 'hard':
    case 'hardcore': return base * 2
    default: return base
  }
}

// ── 结算：饥饿（工具调用）/ 回合（对话）/ 怪物 ─────────────────────────────

export function settle(world: World, cfg: SurvivalConfig, toolName: string): SettleOutcome {
  const outcome: SettleOutcome = {}
  if (world.dead) return outcome

  // 饥饿消耗（疾跑 = 重型工具）
  const cost = HEAVY_TOOLS.has(toolName) ? cfg.heavyHunger : cfg.hungerPerAction
  world.hunger = Math.max(0, world.hunger - cost)

  // 饥饿归零 → 掉血（和平难度除外）
  if (world.hunger === 0 && cfg.difficulty !== 'peaceful') {
    world.hp -= 1
    pushLog(world, '💀 饥饿值为 0，你掉了 1 点生命——吃面包（小麦×3 合成）！')
    if (world.hp <= 0) {
      outcome.cause = '饿死了'
      return outcome
    }
  }

  // 昼夜由对话回合推进（见 onTurn）；工具调用只结算饥饿与怪物遭遇
  if (isNight(world, cfg)) {
    const mob = rollMob(world, cfg)
    if (mob?.cause !== undefined) {
      outcome.cause = mob.cause
      return outcome
    }
    if (mob?.reason !== undefined) outcome.deny = `${mob.reason} 你的这次调用被打断了。`
  } else {
    rollSheep(world)
  }
  outcome.notices = collectTransitions(world, cfg)
  return outcome
}

/**
 * 状态跃迁播报：只在变化瞬间提醒一次（入夜 / 低饥饿 / 低血量），
 * 状态恢复后重新武装——玩家"时刻留意"的紧张感来源。
 */
const HUNGER_WARN_AT = 4
const HP_WARN_AT = 4
const WARN_RESET_AT = 10

function collectTransitions(world: World, cfg: SurvivalConfig): string[] {
  if (world.dead) return []
  const notices: string[] = []

  // 入夜播报 / 黎明战报（天亮时统计昨夜遭遇并清零）
  if (isNight(world, cfg)) {
    if (!world.nightNotified) {
      world.nightNotified = true
      const torch = (world.items.torch ?? 0) > 0
      notices.push(
        `🌙 第 ${world.day} 天夜幕降临——夜晚会刷怪。${torch ? '你带着火把，火光压制了部分怪物（刷怪概率 ×0.8）。' : '没有火把的话合成一个（煤+木棍）压制刷怪；或做床睡觉跳过夜晚（羊毛×3+木板×3）。'}`,
      )
    }
  } else if (world.nightNotified) {
    // 黎明：昨夜战报（让剑盾的耐久消耗有账可查）
    world.nightNotified = false
    if (world.nightEncounters > 0) {
      notices.push(
        `☀️ 昨夜战报：遭遇 ${world.nightEncounters} 次袭击——⚔️击退 ${world.nightRepelled}，🛡️格挡 ${world.nightBlocked}，💔受伤 ${world.nightHurt} 次（共 −${world.nightDamage}❤️）。剑盾在战斗中消耗了耐久（击退/格挡/落空都会磨损）。`,
      )
    } else {
      notices.push('☀️ 昨夜平安无事，一夜好眠。')
    }
    world.nightEncounters = 0
    world.nightRepelled = 0
    world.nightBlocked = 0
    world.nightHurt = 0
    world.nightDamage = 0
  }

  // 低饥饿
  if (world.hunger <= HUNGER_WARN_AT) {
    if (!world.warnedHunger) {
      world.warnedHunger = true
      notices.push(`🍖 饥饿只剩 ${world.hunger}/20——再不吃东西就要掉血了。面包回复 ${cfg.breadHunger} 饥饿（survival_craft bread 然后 survival_eat）。`)
    }
  } else if (world.hunger >= WARN_RESET_AT) {
    world.warnedHunger = false
  }

  // 低血量
  if (world.hp <= HP_WARN_AT) {
    if (!world.warnedHp) {
      world.warnedHp = true
      notices.push(`❤️ 生命只剩 ${world.hp}/20！保持饱食度 ≥10 每回合回 1 血；夜里小心怪物。`)
    }
  } else if (world.hp >= WARN_RESET_AT) {
    world.warnedHp = false
  }

  return notices
}

/**
 * 对话回合结算（每个用户消息触发一次）：
 * 自然再生（吃饱回血）→ 推进昼夜 → 夜晚刷怪 / 白天遇羊。
 * 纯聊天也会过天——昼夜只由对话回合驱动。
 */
export function onTurn(world: World, cfg: SurvivalConfig): TurnOutcome {
  const outcome: TurnOutcome = {}
  if (world.dead) return outcome

  // 回合恢复：每个对话回合回复 1 饥饿（休息/进食的自然节奏，纯聊天也能续命）
  world.hunger = Math.min(MAX_HUNGER, world.hunger + 1)

  // 自然再生（原版规则，门槛放宽）：饱食度 ≥10 时回血；和平难度无条件回血
  if (world.hp < MAX_HP) {
    if (cfg.difficulty === 'peaceful' || world.hunger >= 10) {
      world.hp = Math.min(MAX_HP, world.hp + 1)
      pushLog(
        world,
        `💚 你的伤势好转了——生命回复到 ${world.hp}/${MAX_HP}（${cfg.difficulty === 'peaceful' ? '和平难度自动回复' : '饱食度 ≥10 自然再生'}）。`,
      )
    }
  }

  // 推进昼夜：对话回合计数
  world.turnsToday += 1
  if (world.turnsToday >= cfg.dayLengthTurns) {
    world.day += 1
    world.turnsToday = 0
    outcome.dayChanged = true
    pushLog(world, `☀️ 第 ${world.day} 天开始了。`)
  }

  if (isNight(world, cfg)) {
    const mob = rollMob(world, cfg)
    if (mob?.cause !== undefined) outcome.cause = mob.cause
    else if (mob?.reason !== undefined) pushLog(world, `${mob.reason} 你的回合被打断了。`)
  } else {
    rollSheep(world)
  }
  outcome.notices = collectTransitions(world, cfg)
  return outcome
}

/** 夜晚刷怪：返回骷髅打断原因或死因；剑盾出手即耗耐久（原版：挥剑/举盾必磨损）。 */
function rollMob(world: World, cfg: SurvivalConfig): { reason?: string; cause?: string } | undefined {
  const torchFactor = (world.items.torch ?? 0) > 0 ? cfg.torchMobFactor : 1
  const chance = mobChanceFor(cfg) * torchFactor
  if (chance <= 0) return undefined
  if (Math.random() >= chance) return undefined

  const mob = pickWeighted(MOBS)
  world.nightEncounters += 1

  // 自动反击：钻石剑 > 铁剑 > 石剑（品质优先）；每次遇怪出手即耗 1 耐久，无论是否命中
  const sword =
    (world.items['diamond-sword'] ?? 0) > 0
      ? { item: 'diamond-sword' as ItemId, chance: 0.9, xp: 5, label: '钻石剑' }
      : (world.items['iron-sword'] ?? 0) > 0
        ? { item: 'iron-sword' as ItemId, chance: 0.6, xp: 3, label: '铁剑' }
        : (world.items['stone-sword'] ?? 0) > 0
          ? { item: 'stone-sword' as ItemId, chance: 0.4, xp: 2, label: '石剑' }
          : undefined
  if (sword !== undefined) {
    world.items[sword.item] = (world.items[sword.item] ?? 0) - 1
    if (Math.random() < sword.chance) {
      world.xp += sword.xp
      world.nightRepelled += 1
      const first = unlockAchievement(world, 'monster-hunter')
      pushLog(world, `⚔️ 你挥舞${sword.label}击退了${mob.name}！+${sword.xp} 经验${first ? '（怪猎手！）' : ''}（${sword.label}耐久 -1）`)
      return undefined
    }
    pushLog(world, `⚔️ 你挥剑落空——${mob.name}闪过了你的攻击（${sword.label}耐久 -1）。`)
  }

  // 盾牌：举盾即耗 1 耐久，格挡成否都磨损（骷髅的远程箭不在格挡判定内——它打断的是你的动作）
  if (!mob.denyCall && (world.items.shield ?? 0) > 0) {
    world.items.shield = (world.items.shield ?? 0) - 1
    if (Math.random() < 0.5) {
      world.nightBlocked += 1
      pushLog(world, `🛡️ 盾牌挡住了${mob.name}的攻击！（盾牌耐久 -1）`)
      return undefined
    }
    pushLog(world, `🛡️ 你举盾慢了半拍——${mob.name}绕过了盾牌（盾牌耐久 -1）。`)
  }

  // 承受伤害
  const damage = damageFor(cfg, mob.damage)
  world.hp -= damage
  world.nightHurt += 1
  world.nightDamage += damage
  if (world.hp <= 0) {
    return { cause: mob.death }
  }
  pushLog(world, `🌙 ${mob.name}袭击！-${damage}❤️`)
  if (mob.denyCall) {
    return { reason: `🌙 夜晚！骷髅在远处射箭，-${damage}❤️。（合成火把防刷怪，或合成床睡觉跳过夜晚）` }
  }
  return undefined
}

/** 白天偶尔遇到羊（被动生物，掉羊毛）。 */
function rollSheep(world: World): void {
  if (Math.random() >= 0.05) return
  const wool = 1 + Math.floor(Math.random() * 2)
  addMaterial(world, 'wool', wool)
  pushLog(world, `🐑 你遇到了一群羊，剪到了羊毛×${wool}（羊毛×3 + 木板×3 = 床）。`)
}

// ── 挖矿：任务完成掉矿 ──────────────────────────────────────────────────────

export type LootTier = 'small' | 'medium' | 'deep' | 'deeper'

export function mine(world: World, tier: LootTier, cfg: SurvivalConfig): string[] {
  const lines: string[] = []
  const add = (id: MaterialId, amount: number) => {
    addMaterial(world, id, amount)
    lines.push(`${MATERIAL_LABELS[id]}×${amount}`)
  }
  const gainXp = (amount: number) => {
    world.xp += amount
    lines.push(`经验+${amount}`)
  }

  switch (tier) {
    case 'small': {
      add('cobble', 1)
      const pool: MaterialId[] = ['wood', 'wheat', 'wheat', 'coal']
      add(pool[Math.floor(Math.random() * pool.length)], 1)
      add(pool[Math.floor(Math.random() * pool.length)], 1)
      if (Math.random() < 0.1) add('iron-ore', 1)
      gainXp(2)
      break
    }
    case 'medium': {
      // 防刷：计划退出每天只结算一次中矿（退出本身仍耗饥饿）
      if (world.minedMediumDay === world.day) return []
      world.minedMediumDay = world.day
      add('coal', 2)
      add('iron-ore', 1)
      if (Math.random() < 0.3) add('copper-ore', 1)
      gainXp(10)
      break
    }
    case 'deep': {
      add('iron-ore', 2)
      add('redstone', 2)
      if (Math.random() < 0.25) add('diamond', 1)
      if (Math.random() < 0.25) add('copper-ore', 1)
      if (Math.random() < 0.15) add('amethyst', 1)
      gainXp(15)
      break
    }
    case 'deeper': {
      add('iron-ore', 1)
      add('redstone', 1)
      if (Math.random() < 0.15) add('diamond', 1)
      if (Math.random() < 0.15) add('amethyst', 1)
      gainXp(12)
      break
    }
  }
  void cfg

  if ((world.materials.diamond ?? 0) > 0) unlockAchievement(world, 'diamonds')
  pushLog(world, `⛏️ 挖矿收获：${lines.join('、')}`)
  return lines
}

// ── 死亡 ────────────────────────────────────────────────────────────────────

export function die(world: World, cause: string): DeathInfo {
  const dropped: string[] = []
  for (const [id, amount] of Object.entries(world.items) as [ItemId, number][]) {
    if (id === 'bed' || amount <= 0) continue
    dropped.push(`${ITEM_LABELS[id]}×${amount}`)
    delete world.items[id]
  }
  for (const [id, amount] of Object.entries(world.materials) as [MaterialId, number][]) {
    if (amount <= 0) continue
    dropped.push(`${MATERIAL_LABELS[id]}×${amount}`)
    delete world.materials[id]
  }
  const droppedXp = Math.floor(world.xp / 2)
  world.xp -= droppedXp
  world.dead = true
  const message = `你${cause}！`
  world.death = { message, dropped, droppedXp }
  pushLog(world, `☠️ ${message} 掉落：${dropped.length > 0 ? dropped.join('、') : '空手'}；经验 -${droppedXp}`)
  return world.death
}

export function deathDeny(world: World, cfg: SurvivalConfig): string {
  const dropped = world.death?.dropped.join('、') ?? '空手'
  const base = `☠️ 你死了——${world.death?.message ?? '你死了！'}。背包与半数经验已掉落（掉落：${dropped}；经验 -${world.death?.droppedXp ?? 0}）。本会话已死亡：请在回复中写下你的遗言，然后停止工作。`
  // 文件回退结果由引擎在 deny reason 中追加（respawnNote）；这里只说明存档规则。
  void cfg
  return `${base}（每个会话都是独立存档：新会话从第 1 天、0 经验、空背包重新开始。）`
}

// ── 生存动作：吃 / 合成 / 睡觉 ─────────────────────────────────────────────

export function eat(world: World, food: string, cfg: SurvivalConfig): { ok: boolean; message: string } {
  if (world.dead) return { ok: false, message: '☠️ 你已经死了——不能再吃东西。' }
  if (food !== 'bread') return { ok: false, message: '现在只能吃面包（小麦×3 合成一个）。' }
  if ((world.items.bread ?? 0) <= 0) return { ok: false, message: '背包里没有面包——挖矿攒小麦，用 survival_craft 合成（小麦×3）。' }
  world.items.bread = (world.items.bread ?? 0) - 1
  world.hunger = Math.min(MAX_HUNGER, world.hunger + cfg.breadHunger)
  pushLog(world, `🍞 你吃了一个面包，饥饿 +${cfg.breadHunger}。`)
  return { ok: true, message: `🍞 面包下肚，饥饿 +${cfg.breadHunger}（现在 ${world.hunger}/${MAX_HUNGER}）。` }
}

export function craft(world: World, recipeId: string, cfg: SurvivalConfig): { ok: boolean; message: string } {
  if (world.dead) return { ok: false, message: '☠️ 你已经死了——不能再合成。' }
  const recipe = RECIPES.find((entry) => entry.id === recipeId)
  if (recipe === undefined) {
    return { ok: false, message: `没有「${recipeId}」这个配方。用 survival_status 查看配方书。` }
  }
  const missing = recipe.needs?.find((need) => (world.items[need] ?? 0) <= 0)
  if (missing !== undefined) {
    return { ok: false, message: `需要先有${ITEM_LABELS[missing]}（${RECIPES.find((entry) => entry.id === missing)?.name ?? missing}）才能进行此合成。` }
  }
  for (const [id, amount] of Object.entries(recipe.costs) as [MaterialId, number][]) {
    if ((world.materials[id] ?? 0) < amount) {
      return { ok: false, message: `材料不足：${MATERIAL_LABELS[id]} 需要 ${amount}，你只有 ${world.materials[id] ?? 0}。` }
    }
  }
  // 铁砧修复：目标工具必须存在且有损伤
  if (recipe.repair !== undefined) {
    const max = cfg[recipe.repair.max]
    const current = world.items[recipe.repair.tool] ?? 0
    if (current <= 0) {
      return { ok: false, message: `你没有${ITEM_LABELS[recipe.repair.tool]}，不需要修复——先合成一把。` }
    }
    if (current >= max) {
      return { ok: false, message: `${ITEM_LABELS[recipe.repair.tool]} 完好无损（耐久 ${current}），不需要修复。` }
    }
  }
  // 经验消耗（铁砧修复）
  const xpCost = recipe.xpCost ?? 0
  if (xpCost > world.xp) {
    return { ok: false, message: `经验不足：需要 ${xpCost} 经验，你只有 ${world.xp}。继续挖矿（完成任务）攒经验。` }
  }
  for (const [id, amount] of Object.entries(recipe.costs) as [MaterialId, number][]) {
    takeMaterial(world, id, amount)
  }
  world.xp -= xpCost
  // 铁砧修复：恢复一半耐久（不超过上限）
  if (recipe.repair !== undefined) {
    const max = cfg[recipe.repair.max]
    const restore = Math.max(1, Math.floor(max / 2))
    world.items[recipe.repair.tool] = Math.min(max, (world.items[recipe.repair.tool] ?? 0) + restore)
    pushLog(world, `🔨 铁砧修复：${ITEM_LABELS[recipe.repair.tool]} +${restore} 耐久（消耗 ${xpCost} 经验）。`)
    return {
      ok: true,
      message: `🔨 修复成功：${ITEM_LABELS[recipe.repair.tool]} +${restore} 耐久（现在 ${world.items[recipe.repair.tool]}）——消耗 ${xpCost} 经验。${recipe.note}`,
    }
  }
  // 产物归类：物品栏 = ITEM_LABELS 登记在册的产物；其余全部进背包材料。
  // （绝不能按名字猜——bread/torch/furnace/bed/spyglass 没有连字符，而
  // redstone-torch 有连字符却是材料。）
  if (ITEM_LABELS[recipe.produces as ItemId] !== undefined) {
    addItem(world, recipe.produces as ItemId, recipe.amount, cfg)
  } else {
    addMaterial(world, recipe.produces as MaterialId, recipe.amount)
  }
  if (recipe.id === 'smelt-iron') unlockAchievement(world, 'acquire-hardware')
  pushLog(world, `🛠️ 合成了 ${recipe.name}×${recipe.amount}。`)
  const unlock = UNLOCK_ANNOUNCEMENTS[recipe.produces as ItemId]
  if (unlock !== undefined) pushLog(world, unlock)
  return { ok: true, message: `✅ 合成 ${recipe.name}×${recipe.amount}！${recipe.note}${unlock !== undefined ? ` ${unlock}` : ''}` }
}

export function sleep(world: World, cfg: SurvivalConfig): { ok: boolean; message: string } {
  if (world.dead) return { ok: false, message: '☠️ 你已经死了——死亡不是睡觉。' }
  if ((world.items.bed ?? 0) <= 0) return { ok: false, message: '你没有床。羊毛×3 + 木板×3 合成（白天偶尔会遇到羊）。' }
  if (!isNight(world, cfg)) return { ok: false, message: '现在还是白天，不能睡觉。' }
  world.day += 1
  world.turnsToday = 0
  world.respawnBed = true
  const first = unlockAchievement(world, 'sweet-dreams')
  pushLog(world, `🛏️ 你在床上睡了一觉，跳过夜晚——现在是第 ${world.day} 天。${first ? '（甜甜的梦！）' : ''}`)
  return { ok: true, message: `🛏️ 睡觉成功，一觉到第 ${world.day} 天。床已设置为重生点：死亡时工作区文件将回退到此状态（床不掉落）。` }
}

// ── 展示 ────────────────────────────────────────────────────────────────────

/** 浏览器状态栏的轻量快照（只读叶子数据，可无损过 wire）。 */
export interface HudSnapshot {
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

export function snapshot(world: World, cfg: SurvivalConfig): HudSnapshot {
  return {
    hp: world.hp,
    maxHp: MAX_HP,
    hunger: world.hunger,
    maxHunger: MAX_HUNGER,
    day: world.day,
    night: isNight(world, cfg),
    xp: world.xp,
    dead: world.dead,
    deathMessage: world.death?.message ?? '',
  }
}

/** 原版心形：一颗满心 ❤️ = 2 血，半颗心 💔 = 1 血，空格 🖤。 */
function hearts(world: World): string {
  const full = Math.floor(world.hp / 2)
  const half = world.hp % 2
  return '❤️'.repeat(Math.max(0, full)) + (half > 0 ? '💔' : '') + '🖤'.repeat(Math.max(0, MAX_HP / 2 - full - half))
}

function hungerBar(world: World): string {
  const full = Math.floor(world.hunger / 2)
  const half = world.hunger % 2
  return '🍗'.repeat(full) + (half > 0 ? '🍖' : '') + '🦴'.repeat(Math.max(0, 10 - full - half))
}

function phaseLine(world: World, cfg: SurvivalConfig): string {
  if (isNight(world, cfg)) {
    const left = cfg.dayLengthTurns - world.turnsToday
    return `🌙 夜晚（还有 ${left} 个回合天亮）`
  }
  const left = cfg.dayLengthTurns - nightLength(cfg) - world.turnsToday
  return `☀️ 白天（还有 ${Math.max(0, left)} 个回合入夜）`
}

function materialsLine(world: World): string {
  const entries = Object.entries(world.materials).filter(([, amount]) => (amount ?? 0) > 0)
  if (entries.length === 0) return '（空）'
  return entries.map(([id, amount]) => `${MATERIAL_LABELS[id as MaterialId]}×${amount}`).join(' ')
}

function itemsLine(world: World): string {
  const entries = Object.entries(world.items).filter(([, amount]) => (amount ?? 0) > 0)
  if (entries.length === 0) return '（空）'
  return entries
    .map(([id, amount]) => {
      const label = ITEM_LABELS[id as ItemId]
      return TOOL_DURABILITY[id as ItemId] !== undefined ? `${label}(耐久 ${amount})` : `${label}×${amount}`
    })
    .join(' ')
}

export function formatHud(world: World, cfg: SurvivalConfig): string {
  if (world.dead) {
    return `☠️ 你已死亡——${world.death?.message ?? ''}（本会话终结；每个会话独立存档，新会话从第 1 天开始）`
  }
  const lines = [
    `⛏️ 生存模式 · ${cfg.difficulty} · 第 ${world.day} 天 · ${phaseLine(world, cfg)}`,
    `${hearts(world)} (${world.hp}/20) · ${hungerBar(world)} (${world.hunger}/20) · ⭐${world.xp}`,
  ]
  if (world.hunger <= 4) lines.push('⚠️ 你很饿了——吃面包（survival_eat）或合成面包（小麦×3）。')
  if (isNight(world, cfg) && (world.items.torch ?? 0) <= 0) lines.push('🌙 夜晚会刷怪——合成火把（煤+木棍）压制刷怪（×0.8），或睡在床上（羊毛×3+木板×3）。')
  return lines.join('\n')
}

export function formatStatus(world: World, cfg: SurvivalConfig): string {
  if (world.dead) {
    return [
      '── ☠️ 死亡界面 ──',
      `死亡信息：${world.death?.message ?? '你死了'}`,
      `掉落物品：${world.death?.dropped.join('、') ?? '空手'}；经验 -${world.death?.droppedXp ?? 0}`,
      `墓志铭：你在第 ${world.day} 天离开了这个世界。`,
      '文件：工作区已回退到最近一次备份（重生点或出生点）；重生点之后的文件改动已丢失。',
      '复活方式：开启新会话——每个会话都是独立存档（第 1 天 / 0 经验 / 空背包）。',
    ].join('\n')
  }
  const gated = Object.entries(GATES).map(([tool, gate]) => {
    const owned = (world.items[gate.item] ?? 0) > 0
    const state = gate.permanent ? (owned ? '已解锁' : `需${gate.name}`) : owned ? `已持有（耐久 ${world.items[gate.item]}）` : `需${gate.name}`
    return `${tool}=${state}`
  })
  const unlocked = Object.keys(ACHIEVEMENTS)
    .map((id) => {
      const entry = ACHIEVEMENTS[id]
      return `${world.achievements.includes(id) ? '✓' : '·'} ${entry.name}`
    })
    .join('  ')
  const log = world.log.slice(-8).map((line) => `  ${line}`).join('\n')
  return [
    '── ⛏️ 生存模式状态 ──',
    `难度：${cfg.difficulty} · 世界第 ${world.day} 天 · ${phaseLine(world, cfg)}`,
    `${hearts(world)} (${world.hp}/20) · ${hungerBar(world)} (${world.hunger}/20) · ⭐ 经验 ${world.xp}`,
    `背包材料：${materialsLine(world)}`,
    `物品栏：${itemsLine(world)}`,
    `文件重生点：${world.respawnBed ? '重生点（睡过觉——死亡回退到最近备份）' : '出生点（会话开始时的备份——死亡回退到此）'}`,
    `工具门禁：${gated.join(' · ')}`,
    `进度：${unlocked}`,
    ...(isNight(world, cfg) && world.nightEncounters > 0
      ? [`今夜遭遇：${world.nightEncounters} 次（⚔️击退 ${world.nightRepelled} / 🛡️格挡 ${world.nightBlocked} / 💔受伤 ${world.nightHurt}，−${world.nightDamage}❤️）`]
      : []),
    `最近事件：\n${log}`,
    '── 配方书 ──',
    '木板(木头×1→4) · 木棍(木板×2→4) · 火把(煤+木棍) · 熔炉(圆石×8) · 面包(小麦×3)',
    '铁镐(铁锭×3+木棍×2) · 石剑(圆石×2+木棍) · 铁剑(铁锭×2+木棍) · 钻石剑(钻石×2+木棍) · 盾牌(木板×6+铁锭) · 床(羊毛×3+木板×3)',
    '望远镜(紫水晶碎片+铜锭×2) · 红石火把(红石粉+木棍) · 红石中继器(红石粉+红石火把×2+石头×3)',
    '熔炼(需熔炉)：铁矿石+煤→铁锭 · 铜矿石+煤→铜锭 · 圆石+煤→石头',
    `铁砧(铁锭×12) · 修复(需铁砧)：repair-pickaxe(铁锭+10经验→+${Math.floor(cfg.pickaxeDurability / 2)}耐久) · repair-stone-sword(圆石+5经验→+${Math.floor(cfg.stoneSwordDurability / 2)}) · repair-sword(铁锭+10经验→+${Math.floor(cfg.swordDurability / 2)}) · repair-diamond-sword(钻石+10经验→+${Math.floor(cfg.diamondSwordDurability / 2)}) · repair-shield(木板+10经验→+${Math.floor(cfg.shieldDurability / 2)})`,
    '用 survival_craft 合成（参数填配方 id，如 iron-pickaxe / bread / torch / repair-pickaxe）。',
  ].join('\n')
}
