# @dsh-survival/engine

生存模式规则引擎（Agent 预设行）。提供 `survivalEngine` 服务，在 `tools/pre-execute` 作用域瀑布中硬结算生命/饥饿/门禁/昼夜/怪物，在 `tools/result` 中把真实任务信号结算为挖矿掉落，并通过宿主 `storageDomain` 持久化世界存档，注册 settings 命名空间 `dsh-survival`。

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
