## 生存模式 v0.1.3

Minecraft 生存规则 × 真实编码工作的娱乐性 Agent 预设（engine 0.16.0 · tool-survival 0.6.2 · hud 0.1.3）。

### 玩法变更：重启不再丢进度

- **世界状态随会话落盘**：生命/饥饿/天数/经验/背包/成就/重生点写入 `${DSH_HOME}/survival-respawns/<会话id>/world.json`，每次结算（回合、工具、挖矿、合成、进食、睡觉、死亡）都会保存
- **同一会话重启后完整恢复**：WSL / DSH 重启后恢复对话，进度（血量、饱食度、天数、经验、背包）自动加载；死亡状态同样落盘——死掉的会话不会"复活"
- **独立存档语义不变**：新会话仍从第 1 天、0 经验、空背包开始；`world.json` 随备份目录在会话结束时清理
- **修复**：重生点快照会清空备份目录重建，导致对话摘要 `conversation.md` 被误删——已调整写入顺序（先快照文件，再写对话摘要与世界状态）

### 工程

- 引擎规则层单元测试 **48 例**（新增：世界状态往返、缺失/损坏 JSON 容错）
- README 中英（存档表、故障排查新增"重启后进度归零"条目）、预设人设、engine README 同步

### 安装

见 [docs/installation.md](https://github.com/Socialist-Sister/dsh-survival-mode/blob/main/docs/installation.md)：三个包装进 profile workspace → `cordis.patch.yml` 加 `survival-hud` 宿主行 → 复制 `survival` 预设 → 重启 DSH。升级自 v0.1.2：替换三个包并重启即可（旧版本没有 world.json，升级后进度不迁移属预期）。

### 附件

- `dsh-survival-engine-0.16.0.tgz` — 规则引擎（预设 isolate realm）
- `dsh-survival-tool-survival-0.6.2.tgz` — 生存工具 + HUD
- `dsh-survival-hud-0.1.3.tgz` — 浏览器状态栏桥（宿主行）
