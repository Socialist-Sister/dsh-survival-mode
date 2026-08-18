## 生存模式 v0.1.2

Minecraft 生存规则 × 真实编码工作的娱乐性 Agent 预设（engine 0.15.0 · tool-survival 0.6.2 · hud 0.1.3）。

### 玩法变更

- **白天也能用床**：`survival_sleep` 夜晚 = 睡觉（跳过夜晚、达成就「甜甜的梦」）；白天 = 休息（不跳夜）。两种都会更新重生点
- **重生点 = 文件 + 对话**：出生点（会话开始）与重生点（睡觉/休息）都备份工作区文件 + 对话摘要（`conversation.md`，最近 60 条真实对话）；死亡时文件回退到最近备份
- **播报双通道**：重要状态（入夜 / 低饥饿 / 低血量 / 死亡 / 备份完成）**插队**（`agent.steer`）立即送达 agent，黎明战报等普通播报排队（`agent.followup`）——播报不推进游戏时间
- **昼夜等长**：夜晚 = `floor(dayLengthTurns / 2)` 回合（默认 8 回合一天 → 白天 4 / 夜晚 4，此前夜晚只有 2 回合）
- **入夜决策窗口**：入夜第一回合不刷怪——收到播报后有一回合安全时间回复"睡觉"跳过夜晚；此后每个回合/动作照常刷怪判定
- 其余机制不变：饥饿/怪物/挖矿/原版配方/铁砧修复/工具门禁/五档难度/独立存档/文件重生点/浏览器状态栏

### 工程

- 引擎规则层单元测试 **47 例**（新增：白天休息、对话摘要存档、入夜第一回合窗口、昼夜各半）
- 快照排除目录、对话摘要文件名等细节同步 README 中英与预设人设

### 安装

见 [docs/installation.md](https://github.com/Socialist-Sister/dsh-survival-mode/blob/main/docs/installation.md)：三个包装进 profile workspace → `cordis.patch.yml` 加 `survival-hud` 宿主行 → 复制 `survival` 预设 → 重启 DSH。升级自 v0.1.1：替换三个包并重启即可。

### 附件

- `dsh-survival-engine-0.15.0.tgz` — 规则引擎（预设 isolate realm）
- `dsh-survival-tool-survival-0.6.2.tgz` — 生存工具 + HUD
- `dsh-survival-hud-0.1.3.tgz` — 浏览器状态栏桥（宿主行）
