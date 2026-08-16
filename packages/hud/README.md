# @dsh-survival/hud

生存模式状态栏桥（HOST 行）：浏览器端 Minecraft 风格状态栏（❤️ 心 + 🍗 鸡腿 + 昼夜 + 经验），通过 `kind: 'direct'` 的 Typert Remote 暴露，宿主半面用 `agentPresets.serviceFor(agent, 'survivalEngine')` 读取预设引擎快照（api-proxy 读取 goals/skills 的同一官方通路）。

`capability` 方法以 `composedPreset(agent.ctx) === 'survival'` 门禁——**只在生存模式会话显示，其他模式完全不可见**。client 半面由 `dsh.client` 声明自动挂载（`conversation.input.dock` 座位）。

显示语义对齐原版 Minecraft：满心 ❤️ = 2 血，半心 💔 = 1 血；满鸡腿 🍗 = 2 饥饿，半 🍖 = 1。

```yaml
# cordis.patch.yml（宿主 composition）
- insert:
    - id: survival-hud
      name: '@dsh-survival/hud'
```
