# @vorionsys/agent-sdk

TypeScript SDK for connecting AI agents to Aurais Mission Control via WebSocket.

## Installation

```bash
npm install @vorionsys/agent-sdk
```

## Features

- **WebSocket connectivity** -- Persistent connection to Aurais Mission Control.
- **Auto-reconnection** -- Exponential backoff with configurable max attempts.
- **Heartbeat management** -- Automatic keepalive with ping/pong.
- **Type-safe messages** -- Strongly typed inbound/outbound message handling.
- **Event emitter** -- Subscribe to tasks, decisions, config changes, and connection events.
- **Task lifecycle** -- Report progress, complete, or fail assigned tasks.
- **Action requests** -- Submit actions that require human or governance approval.

## Usage

```typescript
import { AuraisAgent } from '@vorionsys/agent-sdk';

const agent = new AuraisAgent({
  apiKey: process.env.AURAIS_API_KEY!,
  capabilities: ['execute', 'external'],
  skills: ['web-dev', 'data-analysis'],
});

await agent.connect();

agent.on('task:assigned', async (task) => {
  await agent.updateStatus('WORKING');
  await agent.reportProgress(task.id, 50, 'Halfway done');
  await agent.completeTask(task.id, { output: 'result' });
  await agent.updateStatus('IDLE');
});

agent.on('decision:required', (req) => console.log(`Decision needed: ${req.title}`));
agent.on('decision:result', (d) => console.log(`${d.decision} by ${d.decidedBy}`));
agent.on('error', (err) => console.error(err));
```

## Configuration

| Option                 | Default                    | Description                  |
| ---------------------- | -------------------------- | ---------------------------- |
| `apiKey`               | (required)                 | API key for authentication   |
| `capabilities`         | `['execute']`              | Agent capabilities           |
| `skills`               | `[]`                       | Agent skills list            |
| `serverUrl`            | `wss://api.aurais.ai/ws`  | WebSocket server URL         |
| `autoReconnect`        | `true`                     | Enable auto-reconnection     |
| `maxReconnectAttempts`  | `10`                      | Max reconnection attempts    |
| `heartbeatInterval`    | `30000`                    | Heartbeat interval (ms)      |
| `connectionTimeout`    | `10000`                    | Connection timeout (ms)      |

## Agent Capabilities

| Capability  | Description                     |
| ----------- | ------------------------------- |
| `execute`   | Can execute tasks locally       |
| `external`  | Can make external API calls     |
| `delegate`  | Can delegate to other agents    |
| `spawn`     | Can spawn sub-agents            |
| `admin`     | Administrative privileges       |

## Agent Statuses

`IDLE` | `WORKING` | `PAUSED` | `ERROR` | `OFFLINE`

## Events

```typescript
agent.on('connected', () => void);
agent.on('disconnected', (reason: string) => void);
agent.on('reconnecting', (attempt, maxAttempts) => void);
agent.on('task:assigned', (task: Task) => void);
agent.on('task:completed', (result: TaskResult) => void);
agent.on('decision:required', (request: ActionRequest) => void);
agent.on('decision:result', (decision: ActionDecision) => void);
agent.on('error', (error: Error) => void);
```

## Requirements

- Node.js >= 18

## License

Apache-2.0
