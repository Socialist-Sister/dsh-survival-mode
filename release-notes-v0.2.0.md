## 生存模式 v0.2.0

Minecraft 生存规则 × 真实编码工作的娱乐性 Agent 预设（engine 0.19.0 · tool-survival 0.6.3 · hud 0.1.3）。

### 核心变更：死亡不再是删档（v0.1.3 → v0.2.0 累计）

- **死亡机制分档**：
  - **普通难度**（peaceful/easy/normal/hard）死亡 = **软回退**：工作区文件回退到最近备份 + 生命/饱食/时间/经验/背包恢复到重生点时刻（`respawn.json`），成就保留，**会话继续**——死亡代价是重生点之后的进展，不是重开
  - **极限模式**（hardcore）死亡 = **删档**：掉落全部背包与半数经验、文件回退、会话终结（写遗言），新会话是全新世界
- **会话级难度**：每个会话可独立设置难度（`survival_difficulty` 工具，随 `world.json` 落盘）——同时开一个普通会话和一个极限会话互不影响；全局 settings 只是默认值
- **开局难度询问**：新建会话时弹出 GUI 选择框直接选难度（`ctx.userQuestions` 通路）；已设置过的会话恢复时不弹
- **首次接触兜底**：出生点快照与难度询问不再依赖 `agent/session-start` 事件（该事件在预设 realm 不可达），改由用户第一条消息/第一次工具调用触发——死亡回退从此有可靠保障
- **重启恢复进度**：世界状态随会话落盘（`world.json`），同一会话重启后完整恢复；死亡状态保持
- **修复**：重生点快照误删 `conversation.md` 的顺序 bug；README 目录锚点失效（死亡章节改名后）

### 工程

- 引擎规则层单元测试 **50 例**（软回退 revive、重生点状态往返、入夜窗口、昼夜各半等）
- 诊断日志：会话首次接触、难度询问失败原因（失败时直接播报进对话）
- README 中英/预设人设/安装指南全量同步

### 安装

见 [docs/installation.md](https://github.com/Socialist-Sister/dsh-survival-mode/blob/main/docs/installation.md)：三个包装进 profile workspace → `cordis.patch.yml` 加 `survival-hud` 宿主行 → 复制 `survival` 预设 → 重启 DSH。升级自 v0.1.x：替换三个包并重启即可；旧会话存档（`world.json`）可继续恢复，旧版本创建的备份目录会自动补做出生点快照。

### 附件

- `dsh-survival-engine-0.19.0.tgz` — 规则引擎（预设 isolate realm）
- `dsh-survival-tool-survival-0.6.3.tgz` — 生存工具 + HUD
- `dsh-survival-hud-0.1.3.tgz` — 浏览器状态栏桥（宿主行）
