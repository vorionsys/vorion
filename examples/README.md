# Vorion SDK Examples

Practical examples demonstrating the Vorion SDK for AI agent governance.

## Prerequisites

```bash
# Install dependencies
npm install
```

## Examples

### 1. Quickstart (Local Mode)

Demonstrates the SDK in local/in-memory mode - perfect for testing and development.

```bash
npm run quickstart
```

**Features:**
- In-memory trust scoring (no server required)
- Agent registration with capabilities
- Action permission requests
- Trust score evolution
- Action history tracking

### 2. Remote Mode (Cognigate API)

Demonstrates connecting to a running cognigate-api server for persistent governance.

```bash
# First, start the cognigate-api server
cd ../packages/atsf-core && npm run dev

# Then run the example
npm run remote
```

**Features:**
- Remote API connection with authentication
- Persistent trust scoring
- Full audit trails with proof IDs
- Processing time metrics
- Health checks

**Environment Variables:**
- `VORION_API_ENDPOINT` - API URL (default: `http://localhost:3000`)
- `VORION_API_KEY` - API key (default: `vorion-dev-key-12345`)

### 3. LangChain Integration

Demonstrates wrapping LangChain tools with Vorion governance.

```bash
npm run langchain
```

**Features:**
- VorionToolWrapper for LangChain tools
- Automatic permission checking
- Trust-based decision making (GREEN/YELLOW/RED)
- Event-driven architecture
- Dangerous operation blocking

## 8-Tier Trust System

Vorion uses a canonical 8-tier trust system:

| Tier | Name | Score Range | Description |
|------|------|-------------|-------------|
| T0 | Sandbox | 0-199 | Isolated testing environment |
| T1 | Observed | 200-349 | Under active observation |
| T2 | Provisional | 350-499 | Limited operations |
| T3 | Monitored | 500-649 | Continuous monitoring |
| T4 | Standard | 650-799 | Routine operations |
| T5 | Trusted | 800-875 | Expanded capabilities |
| T6 | Certified | 876-950 | Independent operation |
| T7 | Autonomous | 951-1000 | Full autonomy |

## Decision Tiers

- **GREEN** - Action allowed, proceed immediately
- **YELLOW** - Action allowed with constraints or monitoring
- **RED** - Action denied, insufficient trust or missing capability

## Learn More

- [Vorion SDK Documentation](../packages/sdk/README.md)
- [ATSF Core Documentation](../packages/atsf-core/README.md)
- [API Reference](../packages/atsf-core/docs/)
