## 生存模式 v0.1.1

Minecraft 生存规则 × 真实编码工作的娱乐性 Agent 预设（engine 0.14.0 · tool-survival 0.6.1 · hud 0.1.3）。

### 玩法变更：独立存档 + 文件重生点

- **每个会话是独立存档**：世界状态（天数/经验/成就/背包）不再跨会话持久化——新会话一律从第 1 天、0 经验、空背包开始；墓碑表与 `storageDomain` 依赖整体移除
- **文件重生点**：会话开始时引擎自动把工作区备份到 `${DSH_HOME}/survival-respawns/<会话id>/`（出生点）；每次 `survival_sleep` 把备份更新为当前状态（新重生点）
- **死亡回退文件**：死亡时工作区回退到最近一次备份——重生点之后新建/修改/删除的文件全部丢失；物品与材料照常掉落、经验减半（床不掉落）
- **备份范围可配**：默认排除可再生生成物（`node_modules` / `.git` / `dist` 等），settings 新增 `respawnExcludes`（空数组 = 全量备份）；排除目录不备份也不回退
- **只对顶层会话生效**：子代理的死亡不影响文件
- **hardcore 与普通一致**："死亡即删档"随跨会话存档移除，仅保留难度数值（刷怪 ×1.5、伤害 ×2）
- 其余机制不变：饥饿/昼夜/怪物/挖矿/原版配方/铁砧修复/工具门禁/五档难度/跃迁播报/浏览器状态栏

### 工程

- 引擎规则层单元测试扩至 **44 例**（新增文件重生点快照/回退/排除/防护 10 例），Docker 全闭环镜像同步
- README 中英双语重写（含"存档与持久化"一节改为独立存档语义）；安装指南覆盖 Windows/Linux/WSL/macOS 三端

### 安装

见 [docs/installation.md](https://github.com/Socialist-Sister/dsh-survival-mode/blob/main/docs/installation.md)：三个包装进 profile workspace → `cordis.patch.yml` 加 `survival-hud` 宿主行 → 复制 `survival` 预设 → 重启 DSH。升级自 v0.1.0：替换三个包并重启即可，旧存档（storage domain）不再读取，属于预期行为。

### 附件

- `dsh-survival-engine-0.14.0.tgz` — 规则引擎（预设 isolate realm）
- `dsh-survival-tool-survival-0.6.1.tgz` — 生存工具 + HUD
- `dsh-survival-hud-0.1.3.tgz` — 浏览器状态栏桥（宿主行）
