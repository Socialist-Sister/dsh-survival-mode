# 安装指南（Windows / Linux / macOS）

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

## 路径约定（三端对照）

| 概念 | Windows | Linux / WSL / macOS |
|---|---|---|
| `${DSH_HOME}` | `%USERPROFILE%\.dsh` | `~/.dsh` |
| profile workspace（本机示例为 `web`） | `%USERPROFILE%\.dsh\profiles\web` | `~/.dsh/profiles/web` |
| 用户预设根 | `%USERPROFILE%\.dsh\.agent-presets\` | `~/.dsh/.agent-presets/` |
| 设置文件 | `%USERPROFILE%\.dsh\settings.yaml` | `~/.dsh/settings.yaml` |

> **模块解析机制（为什么这么装）**：DSH 每次启动会把安装自身依赖的符号链接集合写入 `${DSH_HOME}/profiles/node_modules/`（`healProfilesModuleFallback`），profile 的 `node_modules` 与预设行都沿 Node 的目录上溯解析。因此**把三个包装进 profile 能解析到的位置即可**——推荐用官方 `dsh plugin` 命令或 `pnpm add`（写入 profile 的 `package.json`，可卸载可升级）；开发模式可改用符号链接直指仓库（改代码 build 后重启即生效，见[开发模式](#开发模式wsl--linux--macos-维护者))。

---

## 方式 A：从 Release 安装（三端用户，推荐）

### 1. 获取三个包

从 [GitHub Releases](https://github.com/Socialist-Sister/dsh-survival-mode/releases) 下载（或本地构建）：

```powershell
# Windows
cd <repo>
pnpm install
pnpm run pack
```

```bash
# Linux / WSL / macOS
cd <repo>
pnpm install
pnpm run pack
```

产出 `dist/` 下三个 tgz：`dsh-survival-engine-0.13.0.tgz`、`dsh-survival-tool-survival-0.6.0.tgz`、`dsh-survival-hud-0.1.3.tgz`（Release 附件的版本号以实际为准）。

### 2. 安装到 profile workspace

**推荐：在 profile 目录用 `pnpm add -w` 安装三个 tgz**（实测通过；`-w` 标志必要——profile 是 pnpm workspace 根，缺省会报 `ERR_PNPM_ADDING_TO_ROOT`）：

```powershell
# Windows
cd $env:USERPROFILE\.dsh\profiles\web
pnpm add -w D:\path\to\dist\dsh-survival-engine-0.13.0.tgz D:\path\to\dist\dsh-survival-tool-survival-0.6.0.tgz D:\path\to\dist\dsh-survival-hud-0.1.3.tgz
```

```bash
# Linux / WSL / macOS
cd ~/.dsh/profiles/web
pnpm add -w /path/to/dist/dsh-survival-engine-0.13.0.tgz /path/to/dist/dsh-survival-tool-survival-0.6.0.tgz /path/to/dist/dsh-survival-hud-0.1.3.tgz
```

> 也可以尝试官方 `dsh plugin --profile web add <tgz>...`（在 profile 目录转发 pnpm 并按 `dsh.bundle` 声明 reconcile 层列表），但实测它在部分 pnpm 版本下因缺少 `-w` 标志报 `ERR_PNPM_ADDING_TO_ROOT`——遇到时退回上面的 `pnpm add -w` 即可。三个包都不声明 `dsh.bundle`（它们不是 bundle 层），所以只会被记为普通依赖、不会进入 `dsh.profile.bundles`——这是预期的，宿主行与预设行在运行时按包名解析，与 bundle 层无关。

### 3. 在 cordis.patch.yml 插入状态栏宿主行

编辑 `${DSH_HOME}/profiles/web/cordis.patch.yml`（Windows：`%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml`），**追加进现有数组**（与已有条目同级缩进）：

```yaml
- insert:
    - id: survival-hud
      name: '@dsh-survival/hud'
```

> 用 `dsh --profile <名> --dump-config` 可随时验证合并结果。

### 4. 安装「生存模式」预设（id: survival）

把本仓库的 `config/agent-presets/survival` 目录复制到用户预设根：

```powershell
# Windows
Copy-Item -Recurse <repo>\config\agent-presets\survival "$env:USERPROFILE\.dsh\.agent-presets\survival"
```

```bash
# Linux / WSL / macOS
mkdir -p ~/.dsh/.agent-presets
cp -r <repo>/config/agent-presets/survival ~/.dsh/.agent-presets/
```

> 复制安装的预设是**漂移快照**：仓库更新后需重新复制（或手工同步改动）。预设发现每次调用都会重读用户预设根——新预设**不需要重启**即可出现在预设列表；但宿主行与包安装需重启才生效。

### 5. 配置难度（可选，settings.yaml）

`${DSH_HOME}/settings.yaml` 中添加 `dsh-survival` 段（不写则用默认值）：

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

### 6. 重启并验证

**重启 DSH**（宿主行与包安装都在启动时生效），新建会话选择「生存模式」预设，验证：

1. 输入框上方出现 Minecraft 状态栏：10 颗心（满心=2 血、半心=1 血）+ 10 根鸡腿 + ☀️/🌙天数 + ⭐经验；
2. 切到其他模式（如标准模式）的新会话，状态栏**完全不可见**；
3. 工具列表出现 `survival_status` / `survival_craft` / `survival_eat` / `survival_sleep`；
4. 系统提示出现 HUD 文本（❤️/🍗/⭐/天数）；
5. 直接调用 `web_search`：没有望远镜时应被引擎拒绝并提示合成配方；
6. 完成一个目标（`update_goal` action=complete）后 `survival_status` 里出现掉矿；
7. `tool-ralph` 不存在（命令方块是创造模式专属，生存不可合成）。

---

## 方式 B：开发模式（WSL / Linux / macOS 维护者）

在开发机上把三个包**符号链接**进 profile 的模块解析根（DSH 已用同一目录存放自身依赖的符号链接集合，`healProfilesModuleFallback` 每次启动只维护安装闭包内的链接、不会动你的手工链接）：

```bash
# 在 WSL / Linux / macOS 开发机
mkdir -p ~/.dsh/profiles/node_modules/@dsh-survival
ln -sfn <repo>/packages/engine         ~/.dsh/profiles/node_modules/@dsh-survival/engine
ln -sfn <repo>/packages/tool-survival  ~/.dsh/profiles/node_modules/@dsh-survival/tool-survival
ln -sfn <repo>/packages/hud            ~/.dsh/profiles/node_modules/@dsh-survival/hud

# 宿主行（同方式 A 第 3 步）与预设（同方式 A 第 4 步）
# 验证包能被 profile 解析：
cd ~/.dsh/profiles/web && node -e "console.log(require.resolve('@dsh-survival/engine/package.json'))"
```

> **重要：开发模式不要同时用 `pnpm add` 安装同一批包**——`pnpm add` 会把 tgz 快照提升到 profile 根 `node_modules`，Node 目录上溯时**优先命中快照、遮蔽符号链接**，改代码 build 后 DSH 仍解析到旧快照。二选一：要么符号链接（本方式），要么 `pnpm add`（方式 A）。

开发循环：改 `packages/*/src` → `pnpm run build` → 重启 DSH → 生效（宿主行变更需重启；预设文件变更每次调用重读）。平台差异：预设里 `tool-bash`/`tool-pwsh` 按 `process.platform` 自动取舍，WSL/Linux/macOS 用 bash，Windows 用 pwsh，无需手动改。

> **Windows 开发机**同样可以 `mklink /D` 或 `junction` 建符号链接指向仓库包目录，机制一致。

---

## 故障排查

| 症状 | 处理 |
|---|---|
| 预设挂载报「Cannot find package」 | 包未装进 profile 可解析位置：确认第 2 步的 `pnpm add -w` 成功（或开发模式的符号链接已建且指向含 `lib/` 的包目录） |
| 预设挂载报行未激活 | 确认部署宿主含 `storageDomain`/`settings`（官方 base + web-app 已含）；引擎对这些服务是可选消费，不会因此卡住 |
| 工具调用没被拦截 | 确认会话确实挂在「生存模式」预设上（其他预设不受影响） |
| 状态栏不显示 | 确认第 3 步的 `survival-hud` 宿主行已插入且已重启；状态栏只在「生存模式」会话显示 |
| 存档丢失 | `storageDomain` 后端未挂载时引擎降级为内存态；确认官方 `storage-json`/`storage-domain` 宿主行存在 |
| `dsh plugin` 报 `ERR_PNPM_ADDING_TO_ROOT` | 用 `cd <profile>` + `pnpm add -w <tgz>...` 手工安装（见第 2 步） |
