# dsh-survival — Survival Mode for DeepSeek Harness

[中文](README.md) · [English](README.en.md)

Minecraft survival rules × real coding work: an entertainment-focused agent preset where the rules **genuinely work and genuinely bite**. Every game concept aligns with vanilla Minecraft survival, and every plugin mechanism follows the official preset spec (same architecture as the dsh-collaboration suite).

**Suite version 0.1.0**: engine 0.13.0 · tool-survival 0.6.0 · hud 0.1.3 · [Installation guide](docs/installation.md) · [GitHub Releases](https://github.com/Socialist-Sister/dsh-survival/releases)

**Highlights**

- 🎮 **Hard-settled vanilla mechanics**: HP 20 (10 hearts), hunger 20, day/night cycles, hostile mobs at night — all settled in real time by the engine at `tools/pre-execute`, not role-played by the prompt
- 🧑‍🚀 **You are the player**: the agent is your avatar and executor — it reports status, obeys your orders, and can be told to self-manage in one sentence
- ⛏️ **Work is mining**: writing files, completing goals, and exiting plan mode drop vanilla ores and XP
- 🔒 **Real tool gates**: no iron pickaxe means no `subagent`; no spyglass means no `web_search` — like mining diamond without a pickaxe
- 💾 **Persistent world saves**: days, XP, achievements, and gravestones persist across sessions; death drops your gear, a new session respawns you
- 🖥️ **Browser status bar**: hearts + drumsticks + day/night + XP, visible only in survival-mode sessions (OpenMoji icons, no copyright concerns)

This file is the complete manual: world rules, survival tools, crafting recipes, item usage, difficulty tiers, settings, save mechanics, the status bar, and troubleshooting.

---

## Contents

1. [Quick Start](#quick-start)
2. [Player & Avatar (Report and Obey)](#player--avatar-report-and-obey)
3. [World Rules](#world-rules)
4. [Survival Tools](#survival-tools)
5. [Mining & Drops](#mining--drops)
6. [Crafting & Items](#crafting--items)
7. [Tool Gates](#tool-gates)
8. [Death & Respawning](#death--respawning)
9. [Difficulty Tiers](#difficulty-tiers)
10. [Advancements](#advancements)
11. [Settings (settings.yaml)](#settings-settingsyaml)
12. [Saves & Persistence](#saves--persistence)
13. [Browser Status Bar](#browser-status-bar)
14. [Tips](#tips)
15. [Troubleshooting](#troubleshooting)
16. [Components & Architecture](#components--architecture)
17. [Asset License](#asset-license)
18. [Development](#development)
19. [Known Limitations & Contributing](#known-limitations--contributing)

---

## Quick Start

1. Install following [docs/installation.md](docs/installation.md) and **restart DSH**;
2. Start a new session and pick the 「生存模式」(Survival Mode) preset;
3. Do real work as usual (coding, researching, writing docs) — the engine hard-settles your survival state in the background;
4. A status bar appears above the input box: ❤️ HP (10 hearts = 20 HP), 🍗 hunger (10 drumsticks = 20 hunger), ☀️/🌙 day, ⭐ XP;
5. Use `survival_status` for the full state and recipe book; finishing tasks drops materials, `survival_craft` crafts, `survival_eat` eats, `survival_sleep` sleeps.

**In one sentence**: work is mining, mining yields materials, materials craft items, items unlock abilities and defense; eat when hungry, defend at night, craft when you can afford it; die and respawn in a new session — the world goes on.

---

## Player & Avatar (Report and Obey)

**You are the player; the agent is your avatar and executor.** Survival decisions are yours:

- **The avatar reports and executes**: the engine pushes events at state transitions (see "Transition notices" below), and the agent relays status and options to you; eating, sleeping, and crafting **wait for your orders by default** — the agent only does the real work you assign.
- **One-sentence delegation**: say "manage survival yourself" and the agent self-manages (eats when hungry, defends at night); say "follow my orders" to take control back.
- **The fun lives here**: you juggle real work while watching your status, commanding meals and crafts, and unlocking abilities by hand — get distracted and you starve or get ambushed.

### Transition notices

The engine pushes a message only at the **moment a state changes** (no spam; re-armed after recovery):

| Event | Notice |
|---|---|
| 🌙 Night falls | Night warning + torch/bed advice |
| ☀️ Dawn report | Last night's encounter count with repel/block/hurt breakdown (the ledger for sword/shield durability); peaceful nights are announced too |
| 🍖 Hunger ≤ 4 | Low-hunger warning + bread instructions |
| ❤️ HP ≤ 4 | Critical-HP warning + healing conditions |
| ⛏️🔭🔴 Unlock | Crafting the pickaxe/spyglass/repeater announces the unlocked ability |
| ☠️ Death | Death message + drop list + respawn instructions |

Notices are plugin-sourced messages and **do not advance game time** (only real user messages count as dialogue turns).

---

## World Rules

### HP & Hunger

| Stat | Maximum | Display |
|---|---|---|
| HP ❤️ | 20 (10 hearts) | one full heart = 2 HP, half a heart = 1 HP |
| Hunger 🍗 | 20 (10 drumsticks) | one full drumstick = 2 hunger, half = 1 |

- **Actions drain hunger**: every tool call −1 (heavy tools are also −1, but are additionally constrained by tool gates).
- **Turns restore hunger**: +1 per dialogue turn (a resting rhythm — pure chat keeps you alive).
- **Free actions** (no hunger, no time): the survival tools themselves, plus observation and conversation — `read` / `glob` / `grep` / `read_image` / `ask_user` / `todo_write` / `create_goal` / `get_goal` / `skill` / `job_list` / `job_output` / `job_kill` / `list_agents`.
- **Hunger at 0 → −1 HP per action** (except in peaceful).
- **Natural regeneration**: each dialogue turn, **hunger ≥ 10 → +1 HP**; peaceful always regenerates. Starving never heals — only eats away at you.

### Day & Night

- **Days advance by dialogue turns**: each user message counts as one turn (pure chat still passes time); one day lasts `dayLengthTurns` turns (default 8), the last third is night.
- Tool calls don't advance time, but they do settle hunger and mob encounters.
- By day you occasionally meet sheep (wool, for beds); at night mobs spawn.

### Hostile Mobs

| Mob | Effect |
|---|---|
| Zombie | −2 HP |
| Skeleton | −2 HP and **interrupts the current tool call** (ranged shot) |
| Creeper | −6 HP (heavy hit; shield blocks it) |
| Spider | −2 HP |

Defense — see [items](#crafting--items): torches suppress spawns (chance ×0.8, not immunity), swords auto-counter (stone 40% / iron 60% / diamond 90%, best-first), shields block, beds skip the night.

---

## Survival Tools

| Tool | What it does |
|---|---|
| `survival_status` | Full state: HP/hunger/XP, day & phase, materials, inventory, gate status, advancements, recent events, and the complete recipe book. **Look here first when unsure.** |
| `survival_craft` | Craft by recipe. Parameter `recipe` takes a recipe id (e.g. `bread`, `iron-pickaxe`, `bed`) — see [the recipe book](#crafting--items). Failures tell you what's missing. |
| `survival_eat` | Eat to restore hunger. Currently only bread (`food` defaults to `bread`), +8 hunger each. |
| `survival_sleep` | Sleep: **only at night and only with a bed**. Skips the night, advances to the next day, and sets the bed as your respawn point (the bed survives death). |

---

## Mining & Drops

**Mining = finishing tasks.** The engine listens to real task signals and pays out on success (XP included):

| Trigger | Drops | XP |
|---|---|---|
| File write succeeds (`write`/`edit`, 70% chance) | cobblestone ×1 + 2 random from wood/wheat/coal (wheat weighted highest); 10% iron ore ×1 | +2 |
| Plan exit (`exit_plan_mode`, **once per day**) | coal ×2 + iron ore ×1; 30% copper ore ×1 | +10 |
| Goal complete (`update_goal` action=complete) | iron ore ×2 + redstone ×2; 25% diamond ×1; 25% copper ore ×1; 15% amethyst ×1 | +15 |
| Subagent success (`subagent`/`subagent_fork` settles) | iron ore ×1 + redstone ×1; 15% diamond ×1; 15% amethyst ×1 | +12 |

Iron/copper ores must be smelted in a furnace before crafting; redstone, diamonds, and amethyst are usable directly.

### XP (⭐)

| Aspect | Rule |
|---|---|
| Earned | Mining drops (table above); sword counters +2/+3/+5 (stone/iron/diamond) |
| **Spent** | **Anvil repair**: `repair-pickaxe` / `repair-stone-sword` / `repair-sword` / `repair-diamond-sword` / `repair-shield` — XP + materials (see [anvil & repair](#crafting--items)) |
| Penalty | Halved (dropped) on death |
| Persistence | XP carries across sessions via the world save |

> Enchanting is not implemented yet (kept out to avoid feature sprawl); anvil repair is the current XP sink — save up to fix tools, don't die with a full purse.

---

## Crafting & Items

### Materials

| Material | Source |
|---|---|
| Wood / cobblestone / coal / wheat | Small tasks (file writes) |
| Wool | Meeting sheep by day (1–2 each) |
| Iron ore / copper ore | Small/medium tasks; needs smelting |
| Redstone | Big tasks (goals / subagents) |
| Diamond / amethyst | Rare deep-mining drops |

### Recipe book (the `recipe` parameter of `survival_craft`)

**Basics**

| Recipe id | Product | Materials | Notes |
|---|---|---|---|
| `planks` | planks ×4 | wood ×1 | Basic building material |
| `stick` | sticks ×4 | planks ×2 | Tool handles |
| `torch` | torch ×1 | coal ×1 + stick ×1 | **Light suppresses spawns: night spawn chance ×0.8 (vanilla light concept — not immunity)** |
| `furnace` | furnace ×1 | cobblestone ×8 | Unlocks smelting |

**Smelting (requires a furnace)**

| Recipe id | Product | Materials |
|---|---|---|
| `smelt-iron` | iron ingot ×1 | iron ore ×1 + coal ×1 |
| `smelt-copper` | copper ingot ×1 | copper ore ×1 + coal ×1 |
| `smelt-stone` | stone ×1 | cobblestone ×1 + coal ×1 |

**Food & tools**

| Recipe id | Product | Materials | Effect |
|---|---|---|---|
| `bread` | bread ×1 | wheat ×3 | +8 hunger per bread |
| `iron-pickaxe` | iron pickaxe | iron ×3 + sticks ×2 | Unlocks `subagent`/`subagent_fork`, −1 durability per use (pool 120, stackable) |
| `stone-sword` | stone sword | cobblestone ×2 + stick ×1 | Starter sword: 40% night counter (+2 XP, durability 50; every counter attempt costs −1, hit or miss) |
| `iron-sword` | iron sword | iron ×2 + stick ×1 | 60% night counter (+3 XP, durability 100; costs on every attempt) |
| `diamond-sword` | diamond sword | diamond ×2 + stick ×1 | Sharper: 90% counter (+5 XP, durability 200; costs on every attempt); used **first** when lower-tier swords are also held |
| `shield` | shield | planks ×6 + iron ×1 | 50% chance to block a hit (durability 120; every block attempt costs −1, blocked or not; cannot stop skeleton arrows) |
| `bed` | bed | wool ×3 + planks ×3 | `survival_sleep` skips the night + sets respawn point (bed survives death) |
| `spyglass` | spyglass | amethyst ×1 + copper ×2 | Unlocks `web_search` (permanent, unbreakable like vanilla) |

**Redstone**

| Recipe id | Product | Materials | Effect |
|---|---|---|---|
| `redstone-torch` | redstone torch ×1 | redstone ×1 + stick ×1 | Circuit component (**a material, not an item**) |
| `redstone-repeater` | redstone repeater ×1 | redstone ×1 + redstone torches ×2 + stone ×3 | Unlocks `workflow` (permanent) |

**Anvil & repair (the XP sink)**

| Recipe id | Product | Materials | Effect |
|---|---|---|---|
| `anvil` | anvil ×1 | iron ×12 | Unlocks anvil repair (vanilla needs 31 ingots; simplified for pacing) |
| `repair-pickaxe` | — | iron ×1 + **10 XP** (needs anvil) | Pickaxe durability +60 (half the cap) |
| `repair-stone-sword` | — | cobblestone ×1 + **5 XP** (needs anvil) | Stone sword durability +25 |
| `repair-sword` | — | iron ×1 + **10 XP** (needs anvil) | Iron sword durability +50 |
| `repair-diamond-sword` | — | diamond ×1 + **10 XP** (needs anvil) | Diamond sword durability +100 |
| `repair-shield` | — | planks ×1 + **10 XP** (needs anvil) | Shield durability +60 |

> Repair requires the target tool to **exist and be damaged** (below its cap); repairs never exceed the cap. Durability values are tunable in `settings.yaml` and repair amounts follow at half the cap.

### How items are used

- **Bread**: consumed automatically by `survival_eat`; eat before hunger hits zero.
- **Torch / spyglass / redstone repeater / furnace / bed**: effective as soon as crafted (sitting in your inventory), no equipping needed.
- **Iron pickaxe**: automatically −1 durability per `subagent`/`subagent_fork` call; when depleted the gate re-engages — recraft (pools stack).
- **Swords (stone/iron/diamond) / shield**: automatic at night; the best sword you hold is used first.
- **Bed**: `survival_sleep` at night only.
- **Durability pools**: tools stack when crafted repeatedly (e.g. two pickaxes = 240 durability).

---

## Tool Gates

In survival mode, advanced abilities require crafted items first — like mining diamond without a pickaxe. The engine **really blocks** calls at `tools/pre-execute` (not prompt theater):

| Tool | Requires | Cost |
|---|---|---|
| `subagent` / `subagent_fork` | iron pickaxe | −1 durability per call |
| `web_search` | spyglass | permanent unlock |
| `workflow` | redstone repeater | permanent unlock |

Calls without the required item are denied with the recipe hint. `tool-ralph` does not exist in this preset — command blocks are creative-mode only and cannot be crafted in survival (vanilla rule).

---

## Death & Respawning

- **Death**: HP hits 0 → vanilla death message ("You were blown up by a Creeper!") → **your whole inventory and materials drop** (the bed stays) → **XP halved** → a gravestone is recorded.
- After death the session is over: every tool except survival tools is denied, the status bar shows ☠️ — write your last words, then close the session.
- **Respawning**: starting a new survival session respawns you. World day, XP (already halved), and advancements persist; the bed (respawn point) is kept if you slept in one; your backpack starts empty.
- **Hardcore**: death wipes the save — the world resets to zero.

---

## Difficulty Tiers

Set via `dsh-survival.difficulty` in `settings.yaml`:

| Difficulty | Effect |
|---|---|
| `peaceful` | No mobs; hunger never drains HP; always regenerates |
| `easy` | Spawn chance ×0.5; mob damage halved (minimum 1) |
| `normal` | Default rates and damage |
| `hard` | Spawn chance ×1.5; mob damage ×2 |
| `hardcore` | Same as hard + **death wipes the save** |

> Note: like vanilla, **difficulty does not affect tool gates** — even in peaceful you still need an iron pickaxe for `subagent`.

---

## Advancements

Vanilla achievement names, kept forever in the world save:

| Advancement | Condition |
|---|---|
| Diamonds! | Mine your first diamond |
| Acquire Hardware | Smelt your first iron ingot |
| Sweet Dreams | Sleep in a bed |
| Monster Hunter | Repel a monster with a sword |

---

## Settings (settings.yaml)

The `dsh-survival` section of `${DSH_HOME}\settings.yaml` (all defaults apply when omitted):

```yaml
dsh-survival:
  difficulty: normal        # peaceful | easy | normal | hard | hardcore
  dayLengthTurns: 8         # dialogue turns per day (user messages); the last 1/3 is night
  mobChance: 0.3            # base spawn chance per night action (0–1)
  torchMobFactor: 0.8       # spawn-chance multiplier while holding a torch (0 = immunity)
  hungerPerAction: 1        # hunger cost per tool call
  heavyHunger: 1            # hunger cost of heavy tools (web/subagent/workflow)
  breadHunger: 8            # hunger restored by bread (keeps the food loop net-positive)
  pickaxeDurability: 120    # pickaxe pool (subagent uses; repair restores half)
  swordDurability: 100      # iron sword pool (counters)
  stoneSwordDurability: 50  # stone sword pool (starter counters)
  diamondSwordDurability: 200 # diamond sword pool (counters)
  shieldDurability: 120     # shield pool (blocks)
  smallLootChance: 0.7      # chance a file write triggers a small mine (0–1)
```

| Field | Meaning | Default |
|---|---|---|
| `difficulty` | Tier, table above | `normal` |
| `dayLengthTurns` | Turns per day; the last `floor(value/3)` turns are night | `8` |
| `mobChance` | Base spawn chance per night action (turn or tool call) | `0.3` |
| `torchMobFactor` | Spawn-chance multiplier while holding a torch | `0.8` |
| `hungerPerAction` | Hunger cost per ordinary tool call | `1` |
| `heavyHunger` | Hunger cost of heavy tools | `1` |
| `breadHunger` | Hunger restored by bread | `8` |
| `pickaxeDurability` | Pickaxe durability pool | `120` |
| `swordDurability` | Iron sword pool | `100` |
| `stoneSwordDurability` | Stone sword pool | `50` |
| `diamondSwordDurability` | Diamond sword pool | `200` |
| `shieldDurability` | Shield pool | `120` |
| `smallLootChance` | Chance a file write triggers a small mine | `0.7` |

---

## Saves & Persistence

| Data | Lifetime |
|---|---|
| World day, XP, deaths, respawn point (bed), advancements | **Persist across sessions** (storage-domain save); written on every mining/crafting/sleep/death event and at session end — restart-proof |
| HP, hunger, materials, inventory | Session memory — a new session (respawn) restores full HP/hunger and an empty backpack (the bed is kept if set) |
| Gravestones (cause and drops of each death) | Persisted (cleared on hardcore death) |

---

## Browser Status Bar

A full-width bar above the composer, shown **only in survival-mode sessions** (gated by the `capability` remote — invisible everywhere else):

- 10 hearts (full = 2 HP, half = 1, black = empty)
- 10 drumsticks (full = 2 hunger, half = 1, grey = empty)
- ☀️/🌙 + day, ⭐ + XP
- ☠️ + death message after death
- Auto-refreshes every 2 seconds; hover for exact numbers

Icons are from OpenMoji (CC BY-SA 4.0) — one uniform icon family, identical size and style everywhere.

---

## Tips

- **Command rhythm**: give orders when transition notices arrive (nightfall / low hunger / low HP); to relax, say "manage survival yourself" at the start and delegate.
- **Opening line**: work first (file writes drop loot) → bread from wheat ×3 to stay alive → furnace from cobblestone ×8 → smelt iron → pickaxe unlocks `subagent`. Deep mines (goal completion) yield redstone and diamonds.
- **Nightfall**: a torch (coal + stick) cuts spawns to ×0.8 but is **not immunity** — swords and shields are the hard defense; wool lets you craft a bed and skip nights entirely.
- **Hunger management**: observation (read/grep) and chat (ask_user) are free — plan in conversation; eat before big batches of work.
- **Death is not failure**: drops are recorded on your gravestone and the world continues; hardcore is another story.
- **Don't waste turns**: the gates are real — stop retrying `web_search` before you have crafted a spyglass.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Preset mount fails with "Cannot find package" | Packages aren't in the profile workspace: check the `file:` dependencies and run `pnpm install` |
| Tool calls aren't being blocked | Make sure the session is actually on the survival preset (other presets are unaffected) |
| Status bar missing | Confirm the `survival-hud` host row is in `cordis.patch.yml` and DSH was restarted; the bar only shows in survival sessions |
| Day/night not advancing | Days advance by user messages (dialogue turns) — pure chat counts; check `dayLengthTurns` if you tuned it |
| Save lost | The engine degrades to in-memory mode when the `storageDomain` backend is missing; confirm the official `storage-json`/`storage-domain` host rows exist |

---

## Components & Architecture

| Component | Plane | Role |
|---|---|---|
| `@dsh-survival/engine` | Agent preset (isolate realm) | Rules engine: hard settlement (`tools/pre-execute` gates/hunger/day-night/mobs), mining settlement (`tools/result`), saves, the `dsh-survival` settings namespace |
| `@dsh-survival/tool-survival` | Agent preset (same realm) | `survival_status` / `survival_craft` / `survival_eat` / `survival_sleep` + the HUD system-prompt section |
| `@dsh-survival/hud` | Host (cordis.patch.yml) | Status-bar bridge: a host-plane typert Remote reads the preset engine via `agentPresets.serviceFor`, gated to survival sessions by `capability` |
| `config/agent-presets/survival` | Agent preset | Display name 「生存模式」; copied from standard, minus ralph (command blocks are creative-only) |

The engine publishes the `survivalEngine` service with all consumers inside the preset; cross-session saves go through the host `storageDomain` service. The only host row is `@dsh-survival/hud` — a preset realm is invisible to the host, and browser RPC needs a host-side Remote (the same official pathway the api-proxy uses to read preset goals/skills).

---

## Asset License

Status-bar icons are from [OpenMoji](https://openmoji.org) (**CC BY-SA 4.0**, attribution-sharealike), one uniform 72×72 icon family — see `packages/hud/assets/ATTRIBUTION.md`. **No Minecraft-copyrighted assets are included.** The project code is MIT (see LICENSE).

---

## Development

```powershell
pnpm install
pnpm run build       # tsup builds lib/ (hud includes the client bundle)
pnpm run typecheck   # build first, then typecheck (tool-survival needs engine's d.ts)
pnpm run pack        # packs tarballs into dist/
```

Installing into DeepSeek Harness: see [docs/installation.md](docs/installation.md).

---

## Known Limitations & Contributing

This is an independent entertainment project with plenty of room to grow — issues and PRs are welcome:

- **Enchanting table**: the soul of MC's XP system (enchantment books, Efficiency/Unbreaking/Sharpness effects) — anvil repair is currently the only XP sink
- **More vanilla items**: armor, axes, hoes, and Nether/End concepts
- **More vanilla events**: thunderstorms (giving copper a second use via lightning rods), villager trading
- **Interactive status panel**: the read-only inventory/recipe panel discussed during design (not yet built)
- **i18n**: the README and in-game text are currently Chinese-first
- **Test coverage**: currently tested manually — automated tests welcome

Feel free to fork and open PRs — bug fixes, tests, balance tuning, and new mechanics are all welcome. Before contributing, please respect the architecture conventions: engine and tools live in the preset's isolate realm (no service published into the root realm), the host side holds only the `@dsh-survival/hud` status-bar bridge, and cross-session saves go through the host `storageDomain` service.
