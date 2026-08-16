## 生存模式 v0.1.0

Minecraft 生存规则 × 真实编码工作的娱乐性 Agent 预设（engine 0.13.0 · tool-survival 0.6.0 · hud 0.1.3）。

### 玩法

- **生命 20（10 心）/ 饥饿 20**：行动耗饥饿、对话回合回复、饱食度 ≥10 回血、饥饿归零掉血
- **昼夜由对话回合推进**：夜晚刷怪（僵尸/骷髅/苦力怕/蜘蛛），黎明战报；火把压制（×0.8）、石/铁/钻石三档剑自动反击、盾牌格挡、床跳过夜晚
- **工作即挖矿**：写文件、退出计划（每日限一次）、完成目标、子代理成功 → 掉落原版矿石与经验
- **原版配方合成**（15 配方）+ **铁砧修复**（经验消耗途径）；工具门禁：铁镐→subagent、望远镜→web_search、红石中继器→workflow
- **死亡与重生**：掉落全部背包+经验减半+墓碑入档；新会话从重生点复活，世界延续；hardcore 死亡删档
- **浏览器状态栏**（OpenMoji 开源图标，仅生存会话显示）+ **跃迁播报**（入夜/低饥饿/低血量/合成解锁/死亡）
- **settings.yaml 全可调**：peaceful / easy / normal / hard / hardcore 五档难度与全部节奏参数
- **存档**：天数/经验/成就/墓碑跨会话持久化

### 安装

见 [docs/installation.md](https://github.com/Socialist-Sister/dsh-survival-mode/blob/main/docs/installation.md)：三个包装进 profile workspace → `cordis.patch.yml` 加 `survival-hud` 宿主行 → 复制 `survival` 预设 → 重启 DSH。

### 附件

- `dsh-survival-engine-0.13.0.tgz` — 规则引擎（预设 isolate realm）
- `dsh-survival-tool-survival-0.6.0.tgz` — 生存工具 + HUD
- `dsh-survival-hud-0.1.3.tgz` — 浏览器状态栏桥（宿主行）
