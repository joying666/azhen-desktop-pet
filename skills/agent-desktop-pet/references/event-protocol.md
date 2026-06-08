# Agent 事件协议

桌宠应该接收通用 Agent 事件，而不是绑定某一个厂商或某一个 Agent 的专用事件。

| 事件 | 含义 | 桌宠状态 |
|---|---|---|
| `agent.task.running` | 任务开始或正在运行 | working |
| `agent.tool.running` | 正在调用工具或执行命令 | working |
| `agent.task.done` | 任务成功完成 | done |
| `agent.task.failed` | 任务失败或报错 | failed |
| `agent.waiting.user` | 等待用户输入或授权 | paused |
| `reminder.water.hourly` | 喝水提醒 | water |

Claude、Codex、Aider、Goose、Open Interpreter 或其它 Agent 的适配器，都应该把自己的生命周期事件映射到这些通用事件。

如果某个 Agent 只有 CLI 命令，可以用包装器启动：

```bash
azhen-agent-pet <agent-command> [args...]
```

如果某个 Agent 支持 hooks 或 notify 命令，可以在对应时机调用：

```bash
azhen-pet-event running
azhen-pet-event done
azhen-pet-event failed
azhen-pet-event paused
azhen-pet-event water
```
