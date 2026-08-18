/**
 * 引擎规则层（game.ts）单元测试 —— Node 内置 node:test，零依赖。
 *
 * game.ts 是纯函数 + 纯数据层，不依赖 Cordis。测试直接编译它。
 * 运行：node --test 或 pnpm test（见根 package.json）。
 *
 * 覆盖：配置默认值 / 世界创建 / 昼夜 / 门禁 / 结算（饥饿·回血·怪物）/
 * 挖矿掉落 / 合成（归类·熔炼·铁砧修复）/ 进食 / 睡眠 / 死亡掉落 / 成就。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_HP, MAX_HUNGER, DEFAULT_CONFIG,
  createWorld, isNight, nightLength,
  settle, onTurn, rollMob, mine, craft, eat, sleep, die, deathDeny,
  RECIPES, GATES, HEAVY_TOOLS, FREE_TOOLS, MOBS, ACHIEVEMENTS,
  MATERIAL_LABELS, ITEM_LABELS, TOOL_DURABILITY,
} from '../src/game.ts'

/** 干净配置 + 干净世界（默认存档）。 */
function freshWorld(overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides }
  const world = createWorld('test-session', {
    xp: 0, day: 1, deaths: 0, respawnBed: false, achievements: [],
  })
  return { cfg, world }
}

// ── 配置与常量 ────────────────────────────────────────────────────────────

test('默认配置：原版数值基线', () => {
  assert.equal(MAX_HP, 20, '生命上限 20 = 10 颗心')
  assert.equal(MAX_HUNGER, 20, '饥饿上限 20 = 10 根鸡腿')
  assert.equal(DEFAULT_CONFIG.dayLengthTurns, 8, '一天 8 回合')
  assert.equal(DEFAULT_CONFIG.mobChance, 0.3)
  assert.equal(DEFAULT_CONFIG.breadHunger, 8, '面包 +8（平衡修复后食物链转正）')
  assert.equal(DEFAULT_CONFIG.smallLootChance, 0.7, '写文件挖矿概率 0.7')
})

test('配方表：17 个配方 id 唯一，材料/产物均有标签', () => {
  const ids = RECIPES.map((r) => r.id)
  assert.equal(new Set(ids).size, RECIPES.length, '配方 id 不重复')
  for (const r of RECIPES) {
    assert.ok(r.id && r.name && r.note, `配方 ${r.id} 有 id/name/note`)
    for (const mat of Object.keys(r.costs)) {
      assert.ok(MATERIAL_LABELS[mat], `配方 ${r.id} 的材料 ${mat} 有中文标签`)
    }
  }
  // 关键配方存在
  for (const id of ['bread', 'iron-pickaxe', 'bed', 'spyglass', 'redstone-repeater', 'anvil', 'repair-pickaxe']) {
    assert.ok(ids.includes(id), `配方 ${id} 存在`)
  }
})

test('工具门禁：subagent/web_search/workflow 各有对应物品', () => {
  assert.equal(GATES.subagent.item, 'iron-pickaxe')
  assert.equal(GATES.web_search.item, 'spyglass')
  assert.equal(GATES.workflow.item, 'redstone-repeater')
  assert.equal(GATES.subagent.permanent, false, '铁镐有耐久')
  assert.equal(GATES.web_search.permanent, true, '望远镜永久')
})

test('重型/免费工具分类', () => {
  for (const t of ['web_search', 'web_fetch', 'subagent', 'subagent_fork', 'workflow']) {
    assert.ok(HEAVY_TOOLS.has(t), `${t} 是重型工具`)
  }
  for (const t of ['read', 'glob', 'grep', 'ask_user', 'todo_write', 'skill', 'job_list']) {
    assert.ok(FREE_TOOLS.has(t), `${t} 是免费动作`)
  }
})

test('怪物表：4 种原版怪物，骷髅打断调用', () => {
  assert.equal(MOBS.length, 4)
  assert.ok(MOBS.some((m) => m.id === 'skeleton' && m.denyCall), '骷髅 denyCall=true')
  assert.ok(MOBS.some((m) => m.id === 'creeper' && m.damage === 6), '苦力怕伤害 6')
})

// ── 世界创建 ──────────────────────────────────────────────────────────────

test('createWorld：满状态出生，继承存档', () => {
  const { world } = freshWorld()
  assert.equal(world.hp, MAX_HP)
  assert.equal(world.hunger, MAX_HUNGER)
  assert.equal(world.day, 1)
  assert.equal(world.dead, false)
  assert.deepEqual(world.items, {}, '出生背包为空')

  const respawned = createWorld('x', { xp: 50, day: 3, deaths: 2, respawnBed: true, achievements: ['diamonds'] })
  assert.equal(respawned.xp, 50)
  assert.equal(respawned.day, 3)
  assert.equal(respawned.deaths, 2)
  assert.deepEqual(respawned.achievements, ['diamonds'])
  assert.deepEqual(respawned.items, { bed: 1 }, '有床则重生点保留床')
})

// ── 昼夜 ──────────────────────────────────────────────────────────────────

test('昼夜：8 回合一天，最后 1/3 是夜晚', () => {
  const cfg = { ...DEFAULT_CONFIG, dayLengthTurns: 8 }
  const world = createWorld('t', { xp: 0, day: 1, deaths: 0, respawnBed: false, achievements: [] })
  assert.equal(nightLength(cfg), Math.floor(8 / 3)) // 2
  assert.equal(isNight(world, cfg), false, '第 0 回合是白天')
  world.turnsToday = 5
  assert.equal(isNight(world, cfg), false)
  world.turnsToday = 6
  assert.equal(isNight(world, cfg), true, '第 6 回合入夜')
})

test('onTurn：回合推进昼夜，跨天返回 dayChanged', () => {
  const { cfg, world } = freshWorld()
  const outcome = onTurn(world, cfg)
  assert.equal(outcome.dayChanged, undefined, '第 1 回合不跨天')
  world.turnsToday = cfg.dayLengthTurns - 1
  const crossed = onTurn(world, cfg)
  assert.equal(crossed.dayChanged, true)
  assert.equal(world.day, 2)
  assert.equal(world.turnsToday, 0)
})

test('onTurn：每回合 +1 饥饿（休息节奏）', () => {
  const { cfg, world } = freshWorld()
  world.hunger = 5
  onTurn(world, cfg)
  assert.equal(world.hunger, 6)
})

test('onTurn：饱食度 ≥10 每回合回 1 血（自然再生）', () => {
  const { cfg, world } = freshWorld()
  world.hp = 10
  world.hunger = 12
  onTurn(world, cfg)
  assert.equal(world.hp, 11, '饱食度 ≥10 回血')

  world.hp = 10
  world.hunger = 8 // 回合 +1 → 9，仍 <10
  onTurn(world, cfg)
  assert.equal(world.hp, 10, '饱食度 <10 不回血')
})

test('onTurn：和平难度无条件回血', () => {
  const { cfg, world } = freshWorld({ difficulty: 'peaceful' })
  world.hp = 8
  world.hunger = 3
  onTurn(world, cfg)
  assert.equal(world.hp, 9)
})

// ── 结算：饥饿与怪物 ──────────────────────────────────────────────────────

test('settle：普通工具 -1 饥饿，重型工具 -1（同价，门禁约束）', () => {
  const { cfg, world } = freshWorld()
  settle(world, cfg, 'bash')
  assert.equal(world.hunger, 19)

  const world2 = freshWorld().world
  settle(world2, cfg, 'subagent')
  assert.equal(world2.hunger, 19, 'heavyHunger 默认 1')
})

test('settle：免费工具的豁免在调用方（pre-execute）层，settle 本身照常结算', () => {
  // 引擎契约：FREE_TOOLS 判定在 index.ts 的 tools/pre-execute 瀑布中提前 return，
  // settle() 只负责对到达它的调用结算饥饿——直接调用 settle('read') 会扣饥饿，
  // 这与上层行为不矛盾（read 根本不会走到 settle）。
  const { cfg, world } = freshWorld()
  settle(world, cfg, 'read')
  assert.equal(world.hunger, 19, 'settle 对任何到达它的工具都结算（免费判定在上层）')
})

test('settle：饥饿归零掉血（非和平），掉到 0 死亡', () => {
  const { cfg, world } = freshWorld()
  world.hunger = 1
  const out = settle(world, cfg, 'bash')
  assert.equal(world.hunger, 0)
  assert.equal(world.hp, 19, '饥饿归零掉 1 血')
  assert.equal(out.cause, undefined)

  world.hp = 1
  world.hunger = 0
  const death = settle(world, cfg, 'bash')
  assert.equal(death.cause, '饿死了')
})

test('settle：夜晚刷怪伤害/骷髅打断', () => {
  const { cfg, world } = freshWorld()
  world.turnsToday = cfg.dayLengthTurns - 1 // 入夜
  // 强制刷怪：把 mobChance 调到 1，且清空防御
  const forced = { ...cfg, mobChance: 1 }
  const w = createWorld('t', { xp: 0, day: 1, deaths: 0, respawnBed: false, achievements: [] })
  w.turnsToday = forced.dayLengthTurns - 1
  const out = settle(w, forced, 'bash')
  assert.ok(w.hp < 20 || out.deny !== undefined, '夜晚遇怪：掉血或被打断')
  if (out.deny !== undefined) assert.ok(out.deny.includes('打断'), '骷髅打断提示')
})

// ── 挖矿 ──────────────────────────────────────────────────────────────────

test('mine：small 掉圆石+2 材料+经验，iron-ore 10% 概率', () => {
  const { cfg, world } = freshWorld()
  const lines = mine(world, 'small', cfg)
  assert.ok(world.materials.cobble >= 1, '必掉圆石')
  assert.ok(lines.some((l) => l.includes('经验+2')))
  assert.ok(world.xp >= 2)
})

test('mine：deep 掉铁+红石，概率掉钻石并解锁成就', () => {
  const { cfg, world } = freshWorld()
  const lines = mine(world, 'deep', cfg)
  assert.ok(world.materials['iron-ore'] >= 2)
  assert.ok(world.materials.redstone >= 2)
  assert.ok(lines.some((l) => l.includes('经验+15')))
  assert.ok(world.xp >= 15)
})

test('mine：medium 每日限一次（防刷矿）', () => {
  const { cfg, world } = freshWorld()
  mine(world, 'medium', cfg)
  const before = world.materials.coal ?? 0
  mine(world, 'medium', cfg)
  assert.equal(world.materials.coal ?? 0, before, '同一天第二次中矿不结算')
})

test('mine：挖到钻石解锁「钻石！」成就', () => {
  const { cfg, world } = freshWorld()
  // 直接塞钻石再挖，mine 末尾检查 materials.diamond
  world.materials.diamond = 1
  mine(world, 'deep', cfg)
  assert.ok(world.achievements.includes('diamonds'), '钻石！成就解锁')
})

// ── 合成 ──────────────────────────────────────────────────────────────────

test('craft：材料不足返回失败', () => {
  const { cfg, world } = freshWorld()
  const r = craft(world, 'bread', cfg)
  assert.equal(r.ok, false)
  assert.match(r.message, /材料不足|小麦/)
})

test('craft：面包归类到物品栏，非材料', () => {
  const { cfg, world } = freshWorld()
  world.materials.wheat = 3
  const r = craft(world, 'bread', cfg)
  assert.equal(r.ok, true)
  assert.equal(world.items.bread, 1, '面包进物品栏')
  assert.equal(world.materials.wheat, 0, '小麦被消耗')
})

test('craft：木板归类到材料（ITEM_LABELS 无 plank）', () => {
  const { cfg, world } = freshWorld()
  world.materials.wood = 1
  const r = craft(world, 'planks', cfg)
  assert.equal(r.ok, true)
  assert.equal(world.materials.plank, 4, '木板×4 进背包材料')
  assert.equal(world.materials.wood, 0)
})

test('craft：熔炼铁锭需熔炉，解锁「铁器时代」', () => {
  const { cfg, world } = freshWorld()
  world.materials['iron-ore'] = 1
  world.materials.coal = 1
  const noFurnace = craft(world, 'smelt-iron', cfg)
  assert.equal(noFurnace.ok, false, '无熔炉不能熔炼')

  world.items.furnace = 1
  const ok = craft(world, 'smelt-iron', cfg)
  assert.equal(ok.ok, true)
  assert.equal(world.materials.iron, 1)
  assert.ok(world.achievements.includes('acquire-hardware'), '铁器时代解锁')
})

test('craft：铁镐有耐久池（合成即 +120）', () => {
  const { cfg, world } = freshWorld()
  world.materials.iron = 3
  world.materials.stick = 2
  const r = craft(world, 'iron-pickaxe', cfg)
  assert.equal(r.ok, true)
  assert.equal(world.items['iron-pickaxe'], cfg.pickaxeDurability, '耐久池 = 120')
})

test('craft：铁砧修复消耗经验与材料，恢复一半耐久', () => {
  const { cfg, world } = freshWorld()
  world.items.furnace = 1
  world.materials.iron = 1
  world.materials.coal = 1
  craft(world, 'smelt-iron', cfg) // 1 铁锭
  world.materials.iron = 12
  craft(world, 'anvil', cfg) // 铁砧
  world.items['iron-pickaxe'] = 10 // 残耐久
  world.xp = 20
  world.materials.iron = 1
  const r = craft(world, 'repair-pickaxe', cfg)
  assert.equal(r.ok, true)
  assert.equal(world.items['iron-pickaxe'], 10 + cfg.pickaxeDurability / 2, '恢复一半耐久')
  assert.equal(world.xp, 10, '消耗 10 经验')
})

test('craft：修复完好工具被拒', () => {
  const { cfg, world } = freshWorld()
  world.materials.iron = 13
  world.materials.stick = 2
  world.items.furnace = 1
  world.materials.coal = 1
  world.xp = 50
  craft(world, 'smelt-iron', cfg)
  craft(world, 'anvil', cfg)
  craft(world, 'iron-pickaxe', cfg) // 满耐久 120
  const r = craft(world, 'repair-pickaxe', cfg)
  assert.equal(r.ok, false, '满耐久拒绝修复')
})

// ── 进食 ──────────────────────────────────────────────────────────────────

test('eat：吃面包 +8 饥饿，上限 20', () => {
  const { cfg, world } = freshWorld()
  world.items.bread = 1
  world.hunger = 10
  const r = eat(world, 'bread', cfg)
  assert.equal(r.ok, true)
  assert.equal(world.hunger, 18)

  world.items.bread = 1
  world.hunger = 19
  eat(world, 'bread', cfg)
  assert.equal(world.hunger, 20, '不超上限')
})

test('eat：没面包 / 已死亡拒绝', () => {
  const { cfg, world } = freshWorld()
  assert.equal(eat(world, 'bread', cfg).ok, false, '无面包')
  world.items.bread = 1
  world.dead = true
  assert.equal(eat(world, 'bread', cfg).ok, false, '死亡不能吃')
})

// ── 睡眠 ──────────────────────────────────────────────────────────────────

test('sleep：夜晚+有床才能睡，跳过夜晚并设重生点', () => {
  const { cfg, world } = freshWorld()
  world.items.bed = 1
  assert.equal(sleep(world, cfg).ok, false, '白天不能睡')

  world.turnsToday = cfg.dayLengthTurns - 1 // 入夜
  const r = sleep(world, cfg)
  assert.equal(r.ok, true)
  assert.equal(world.day, 2, '睡到第二天')
  assert.equal(world.turnsToday, 0)
  assert.equal(world.respawnBed, true, '床设为重生点')
  assert.ok(world.achievements.includes('sweet-dreams'), '甜甜的梦成就')
})

// ── 死亡 ──────────────────────────────────────────────────────────────────

test('die：掉落全部背包与材料，经验减半，床保留', () => {
  const { cfg, world } = freshWorld()
  world.items['iron-pickaxe'] = 60
  world.items.bed = 1
  world.items.bread = 2
  world.materials.iron = 5
  world.materials.wheat = 3
  world.xp = 40
  const death = die(world, '被苦力怕炸死了')
  assert.equal(world.dead, true)
  assert.match(death.message, /被苦力怕炸死了/)
  assert.equal(death.droppedXp, 20, '经验减半')
  assert.equal(world.xp, 20)
  assert.equal(world.items.bed, 1, '床不掉落')
  assert.equal(world.items['iron-pickaxe'], undefined, '铁镐掉落')
  assert.equal(world.items.bread, undefined, '面包掉落')
  assert.equal(world.materials.iron, undefined, '材料掉落')
  assert.ok(death.dropped.length >= 3, '掉落清单含多个条目')
})

test('deathDeny：普通难度提示重生，hardcore 提示删档', () => {
  const { cfg, world } = freshWorld()
  die(world, '被僵尸杀死了')
  assert.match(deathDeny(world, cfg), /新会话将从重生点复活/)
  const w2 = freshWorld({ difficulty: 'hardcore' }).world
  die(w2, '被僵尸杀死了')
  assert.match(deathDeny(w2, { ...cfg, difficulty: 'hardcore' }), /删档/)
})

test('成就表：4 项原版成就', () => {
  assert.deepEqual(Object.keys(ACHIEVEMENTS).sort(), ['acquire-hardware', 'diamonds', 'monster-hunter', 'sweet-dreams'])
})

// ── 工具耐久模型 ──────────────────────────────────────────────────────────

test('有耐久的物品：铁镐/三档剑/盾牌', () => {
  assert.equal(TOOL_DURABILITY['iron-pickaxe'], 'pickaxeDurability')
  assert.equal(TOOL_DURABILITY['stone-sword'], 'stoneSwordDurability')
  assert.equal(TOOL_DURABILITY['iron-sword'], 'swordDurability')
  assert.equal(TOOL_DURABILITY['diamond-sword'], 'diamondSwordDurability')
  assert.equal(TOOL_DURABILITY.shield, 'shieldDurability')
  assert.equal(TOOL_DURABILITY.bread, undefined, '面包无耐久')
})

// ── 端到端：一个完整生存周期 ──────────────────────────────────────────────

test('完整周期：挖矿→合成→进食→昼夜→死亡掉落', () => {
  const { cfg, world } = freshWorld()
  // 挖矿
  mine(world, 'deep', cfg)
  assert.ok(world.xp >= 15)
  // 合成与进食
  world.materials.wheat = 3
  craft(world, 'bread', cfg)
  world.hunger = 5
  eat(world, 'bread', cfg)
  assert.ok(world.hunger > 5, '吃完饥饿上升')
  // 昼夜推进 9 回合
  for (let i = 0; i < 9; i++) onTurn(world, cfg)
  assert.ok(world.day >= 2, '至少过了一天')
  // 死亡
  world.hp = 1
  const death = die(world, '被苦力怕炸死了')
  assert.equal(world.dead, true)
  assert.ok(death.dropped.length >= 0)
})
