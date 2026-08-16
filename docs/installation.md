# 安装指南

`dsh-survival` 生存模式套件：引擎与工具都在「生存模式」预设内部（isolate realm），跨会话存档消费宿主 `storageDomain` 服务；唯一的宿主行是 `@dsh-survival/hud` 状态栏桥（浏览器 RPC 需要宿主侧 Remote，用 `agentPresets.serviceFor` 读预设引擎——`capability` 门禁保证状态栏**只在生存模式显示**）。

| 组件 | 平面 | 安装位置 |
|---|---|---|
| `@dsh-survival/engine` 规则引擎 | Agent 预设（isolate realm） | profile workspace + `survival` 预设行 |
| `@dsh-survival/tool-survival` 生存工具 | Agent 预设（同 realm） | `survival` 预设行 |
| `@dsh-survival/hud` 状态栏桥 | 宿主 | profile workspace + `cordis.patch.yml` insert 行 |
| `survival` 预设（显示名：生存模式） | Agent | `${DSH_HOME}/.agent-presets/survival/` |
| 难度与节奏 | 配置 | `${DSH_HOME}/settings.yaml` 的 `dsh-survival` 段（可选） |

## 前置条件

- DeepSeek Harness 已安装并可启动（本套件基于 `@deepseek-ai/dsh-*` 0.1.0-rc 系列 API）
- Node.js ≥ 20，pnpm ≥ 9
- 部署为官方 standard / cordis 等预设提供的标准宿主（`storageDomain` / `settings` / `typert` / `agentPresets` 服务，官方 base + web-app 已含）

## 1. 构建并打包

在仓库根目录执行：

```powershell
pnpm install
pnpm run pack
```

产出 `dist/` 下三个 tgz：`dsh-survival-engine-0.13.0.tgz`、`dsh-survival-tool-survival-0.6.0.tgz`、`dsh-survival-hud-0.1.3.tgz`。

## 2. 安装包到 profile workspace

> **路径约定**：`${DSH_HOME}` 指 DSH 用户数据目录（Windows 下通常为 `%USERPROFILE%\.dsh`）；`profile workspace` 指 `${DSH_HOME}\profiles\<profile名>`（本机示例为 `web`）。profile workspace 使用 hoisted nodeLinker，预设行从 profile 根 `node_modules` 解析。

把三个 `.tgz` 复制到 `<profile>\dsh-survival\dist\`，然后在 profile 的 `package.json` 添加依赖：

```json
"dependencies": {
  "@dsh-survival/engine": "file:dsh-survival\\dist\\dsh-survival-engine-0.13.0.tgz",
  "@dsh-survival/tool-survival": "file:dsh-survival\\dist\\dsh-survival-tool-survival-0.6.0.tgz",
  "@dsh-survival/hud": "file:dsh-survival\\dist\\dsh-survival-hud-0.1.3.tgz"
}
```

在 profile 目录执行：

```powershell
pnpm install
```

## 3. 在 cordis.patch.yml 插入状态栏宿主行

编辑 `<profile>\cordis.patch.yml`，追加：

```yaml
- insert:
    - id: survival-hud
      name: '@dsh-survival/hud'
```

> 已有 patch 内容请把该条目**追加进现有数组**（与已有条目同级缩进）。用 `dsh --profile <名> --dump-config` 可验证合并结果。

## 4. 安装「生存模式」预设（id: survival）

把本仓库的 `config/agent-presets/survival` 目录复制到用户预设根：

```powershell
Copy-Item -Recurse <repo>\config\agent-presets\survival "$env:USERPROFILE\.dsh\.agent-presets\survival"
```

> 复制安装的预设是漂移快照：仓库更新后需重新复制（或手工同步改动）。已有会话不受影响，新会话按重启时的副本挂载。

## 5. 配置难度（可选，settings.yaml）

`${DSH_HOME}\settings.yaml` 中添加 `dsh-survival` 段（不写则用默认值）：

```yaml
dsh-survival:
  difficulty: normal        # peaceful | easy | normal | hard | hardcore
  dayLengthTurns: 8         # 一天包含的对话回合数（用户消息），最后 1/3 为夜晚
  mobChance: 0.3            # 夜晚每个回合/工具调用的刷怪基础概率
  torchMobFactor: 0.8       # 持有火把时刷怪概率的倍率（光照压制；0=免疫）
  hungerPerAction: 1        # 普通工具调用的饥饿消耗
  heavyHunger: 1            # 重型工具（web/subagent/workflow）的饥饿消耗
  breadHunger: 8            # 面包回复饥饿（食物链净收益转正）
  pickaxeDurability: 120    # 铁镐耐久（subagent 可用次数池，修复量为其一半）
  swordDurability: 100      # 铁剑耐久（反击次数池）
  stoneSwordDurability: 50  # 石剑耐久（入门反击池）
  diamondSwordDurability: 200 # 钻石剑耐久（反击次数池）
  shieldDurability: 120     # 盾牌耐久（格挡次数池）
  smallLootChance: 0.7      # 写文件触发小矿的概率
```

## 6. 重启并验证

重启 DSH，新建会话选择「生存模式」预设，验证：

1. 输入框上方出现 Minecraft 状态栏：10 颗心（满心=2 血、半心=1 血）+ 10 根鸡腿 + ☀️/🌙天数 + ⭐经验；
2. 切到其他模式（如标准模式）的新会话，状态栏**完全不可见**；
3. 工具列表出现 `survival_status` / `survival_craft` / `survival_eat` / `survival_sleep`；
4. 系统提示出现 HUD 文本（❤️/🍗/⭐/天数）；
5. 直接调用 `web_search`：没有望远镜时应被引擎拒绝并提示合成配方；
6. 完成一个目标（`update_goal` action=complete）后 `survival_status` 里出现掉矿；
7. `tool-ralph` 不存在（命令方块是创造模式专属，生存不可合成）。

## 故障排查

| 症状 | 处理 |
|---|---|
| 预设挂载报「Cannot find package」 | 包未装进 profile workspace：确认第 2 步的 `file:` 依赖与 `pnpm install` |
| 预设挂载报行未激活 | 确认部署宿主含 `storageDomain`/`settings`（官方 base + web-app 已含）；引擎对这些服务是可选消费，不会因此卡住 |
| 工具调用没被拦截 | 确认会话确实挂在「生存模式」预设上（其他预设不受影响） |
| 状态栏不显示 | 确认第 3 步的 `survival-hud` 宿主行已插入且已重启；状态栏只在「生存模式」会话显示 |
| 存档丢失 | `storageDomain` 后端未挂载时引擎降级为内存态；确认官方 `storage-json`/`storage-domain` 宿主行存在 |
