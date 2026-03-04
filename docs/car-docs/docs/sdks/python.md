---
sidebar_position: 2
title: Python SDK
---

# Python SDK

The `vorion-car` Python package provides an async client for the CAR system using `httpx` and `pydantic`.

## Installation

```bash
pip install vorion-car
```

## Parsing

```python
from vorion_car import parse_car, build_car

# Parse a CAR string
car = parse_car("a3i.vorion.banquet-advisor:FHC-L3@1.2.0")

print(car.registry)      # 'a3i'
print(car.organization)  # 'vorion'
print(car.agent_class)   # 'banquet-advisor'
print(car.domains)       # ['C', 'F', 'H']
print(car.level)         # 3
print(car.version)       # '1.2.0'
```

## Building

```python
from vorion_car import build_car

car_string = build_car(
    registry="a3i",
    organization="myorg",
    agent_class="data-processor",
    domains=["D", "E"],
    level=2,
    version="1.0.0",
)
# "a3i.myorg.data-processor:DE-L2@1.0.0"
```

## Async Client

```python
from vorion_car import CARClient

async def main():
    client = CARClient(
        endpoint="https://api.agentanchor.io",
        api_key=os.environ["CAR_API_KEY"],
    )

    # Get agent info
    agent = await client.get_agent("a3i.vorion.banquet-advisor:FHC-L3@1.2.0")

    # Get trust score
    trust = await client.get_trust_score(agent.did)
    print(f"Score: {trust.score}, Tier: T{trust.tier}")

    # Query agents
    agents = await client.query_agents(
        domains=["F", "H"],
        min_level=2,
        min_trust=4,
    )

    await client.close()
```

## Pydantic Types

```python
from vorion_car.types import ParsedCAR, TrustScore, DomainCode

class ParsedCAR(BaseModel):
    car: str
    registry: str
    organization: str
    agent_class: str
    domains: list[DomainCode]
    domain_bitmask: int
    level: int  # 0-7
    version: str
    extensions: list[str] | None = None

class TrustScore(BaseModel):
    score: int          # 0-1000
    tier: int           # 0-7
    tier_name: str
    certification: float
    behavior: float
    context: float
    evaluated_at: datetime
```

## FastAPI Integration

```python
from fastapi import Depends, HTTPException
from vorion_car import parse_car

def require_car(
    domains: list[str] | None = None,
    min_level: int = 0,
    min_trust: int = 0,
):
    async def dependency(authorization: str = Header()):
        token = decode_token(authorization)
        car = parse_car(token.aci)

        if domains and not all(d in car.domains for d in domains):
            raise HTTPException(403, "Insufficient domain authorization")

        if car.level < min_level:
            raise HTTPException(403, f"Requires L{min_level}+")

        return car
    return dependency

@app.post("/transactions")
async def create_transaction(
    car: ParsedCAR = Depends(require_car(domains=["F"], min_level=3)),
):
    ...
```
