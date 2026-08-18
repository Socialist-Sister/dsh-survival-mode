# @dsh-survival/engine

生存模式规则引擎（Agent 预设行）。提供 `survivalEngine` 服务，在 `tools/pre-execute` 作用域瀑布中硬结算生命/饥饿/门禁/昼夜/怪物，在 `tools/result` 中把真实任务信号结算为挖矿掉落，注册 settings 命名空间 `dsh-survival`。

**独立存档 + 文件重生点**：世界状态（天数/经验/成就/背包）是会话内存态，不跨会话持久化——每个会话从第 1 天、0 经验、空背包开始。会话开始时引擎自动把工作区快照到 `${DSH_HOME}/survival-respawns/<会话id>/`（出生点）；每次睡觉覆盖快照（新重生点）；死亡时工作区回退到最近一次快照（重生点之后的文件改动丢失）。只对顶层会话生效，子代理的死亡不碰文件。快照排除可再生生成物（`node_modules` / `.git` / `dist` 等，可用 settings `respawnExcludes` 覆盖）。

必须与消费者 `@dsh-survival/tool-survival` 放在同一个 `isolate: { survivalEngine: true }` 组内（服务不得发布进 root realm）。

```yaml
- id: survival
  name: cordis:group
  group: true
  isolate:
    survivalEngine: true
  config:
    - id: survival-engine
      name: '@dsh-survival/engine'
    - id: tool-survival
      name: '@dsh-survival/tool-survival'
```
