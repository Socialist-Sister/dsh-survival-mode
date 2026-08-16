# @dsh-survival/tool-survival

生存模式工具包（Agent 预设行）。`inject` 消费同 realm 的 `survivalEngine` 服务，注册 `survival_status` / `survival_craft` / `survival_eat` / `survival_sleep` 四个工具，并通过 `systemPrompt.section` 渲染 HUD 状态区。

```yaml
- id: tool-survival
  name: '@dsh-survival/tool-survival'
```
