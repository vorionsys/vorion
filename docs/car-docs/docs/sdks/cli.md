---
sidebar_position: 3
title: CLI
---

# CAR CLI

The `@vorion/car-cli` provides command-line tools for inspecting, evaluating, and managing CAR agents.

## Installation

```bash
npm install -g @vorion/car-cli
```

## Commands

### `car stats`

Display agent statistics and metadata.

```bash
car stats a3i.vorion.banquet-advisor:FHC-L3@1.2.0

# Output:
# Agent: a3i.vorion.banquet-advisor:FHC-L3@1.2.0
# Registry:     a3i
# Organization: vorion
# Class:        banquet-advisor
# Domains:      Communications, Finance, Hospitality
# Level:        L3 (Execute)
# Version:      1.2.0
# Trust Score:  742 (T4 Standard)
```

### `car evaluate`

Evaluate an agent's current trust score and tier.

```bash
car evaluate a3i.vorion.banquet-advisor:FHC-L3@1.2.0

# Output:
# Trust Score: 742 / 1000
# Tier: T4 (Standard)
# Components:
#   Certification: 0.80 (T5 certified)
#   Behavior:      0.72 (good history)
#   Context:       0.65 (standard deployment)
# Ceiling: NIST AI RMF (max 899)
```

### `car ceiling`

Check regulatory and organizational ceilings.

```bash
car ceiling a3i.vorion.banquet-advisor:FHC-L3@1.2.0

# Output:
# Regulatory Ceiling: NIST AI RMF → T5 (max 899)
# Org Ceiling:        vorion → T6 (max 950)
# Effective Ceiling:  T5 (899)
```

### `car agent`

Get full agent details from the registry.

```bash
car agent a3i.vorion.banquet-advisor:FHC-L3@1.2.0

# Shows: DID, attestations, creation date, provenance, extensions
```

### `car provenance`

Display agent provenance chain.

```bash
car provenance a3i.vorion.banquet-advisor:FHC-L3@1.2.0

# Output:
# Creation: FRESH (2026-01-15)
# Modifications:
#   2026-01-20: Domain added (H)
#   2026-02-01: Level promoted (L2 → L3)
#   2026-02-05: Extension added (cognigate)
```

### `car alerts`

Check for active alerts or anomalies.

```bash
car alerts a3i.vorion.banquet-advisor:FHC-L3@1.2.0

# Output:
# No active alerts
```

### `car presets`

View and manage trust scoring presets.

```bash
car presets list
car presets show vorion-default
```

## Configuration

```bash
# Set default API endpoint
car config set endpoint https://api.agentanchor.io

# Set API key
car config set apiKey <your-api-key>

# Set default registry
car config set registry a3i
```

## Output Formats

```bash
# JSON output
car stats a3i.vorion.banquet-advisor:FHC-L3@1.2.0 --json

# Table output (default)
car stats a3i.vorion.banquet-advisor:FHC-L3@1.2.0 --table

# Quiet mode (values only)
car evaluate a3i.vorion.banquet-advisor:FHC-L3@1.2.0 --quiet
# 742
```
