---
sidebar_position: 1
title: STPA-TRiSM Integration
---

# STPA-TRiSM Integration Specification
## Automatic Hazard-to-Governance Mapping

**Version:** 1.0
**Status:** Specification
**Target:** Q2-Q3 2026

---

## Executive Summary

This specification defines how ATSF's **STPA (System-Theoretic Process Analysis)** hazard analysis automatically populates **AI TRiSM** governance pillars. The integration transforms safety engineering outputs into actionable governance controls, creating a closed-loop system where:

1. STPA identifies hazards and unsafe control actions
2. Hazards automatically map to TRiSM pillars
3. TRiSM enforces controls based on hazard severity
4. Cognitive Cube tracks causal chains for continuous learning

This eliminates manual translation between safety analysis and governance enforcement.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        STPA Analysis Engine                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Hazards    │  │    UCAs      │  │   Scenarios  │              │
│  │  Identified  │──▶│   Defined    │──▶│   Generated  │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼ Auto-Mapping
┌─────────────────────────────────────────────────────────────────────┐
│                      STPA-TRiSM Mapper                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Hazard Type → TRiSM Pillar Routing                          │   │
│  │  • Safety hazards → Security Pillar                          │   │
│  │  • Privacy hazards → Privacy Pillar                          │   │
│  │  • Behavioral hazards → Explainability Pillar                │   │
│  │  • Operational hazards → ModelOps Pillar                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼ Control Generation
┌─────────────────────────────────────────────────────────────────────┐
│                       AI TRiSM Pillars                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐ │
│  │ Explainability│  │   ModelOps   │  │   Security   │  │ Privacy │ │
│  │    Pillar    │  │    Pillar    │  │    Pillar    │  │  Pillar │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼ Causal Tracking
┌─────────────────────────────────────────────────────────────────────┐
│                      Cognitive Cube                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │     TKG      │  │     ART      │  │   Granger    │              │
│  │   (Causal    │  │  (Cluster    │  │  (Causality  │              │
│  │    Graph)    │  │   Hazards)   │  │   Testing)   │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Hazard-to-Pillar Mapping Rules

### Mapping Matrix

| Hazard Category | Primary Pillar | Secondary Pillars | Auto-Generated Controls |
|-----------------|----------------|-------------------|-------------------------|
| **H-SAFETY** (Physical harm) | Security | ModelOps | Kill-switch trigger, Action blocking |
| **H-PRIVACY** (Data exposure) | Privacy | Security | PII filtering, Access control |
| **H-BIAS** (Unfair outcomes) | Explainability | Privacy | Bias probing, Outcome monitoring |
| **H-DRIFT** (Behavioral change) | Explainability | ModelOps | Drift detection, Rollback triggers |
| **H-SECURITY** (Adversarial attack) | Security | All | Injection detection, Input validation |
| **H-RELIABILITY** (System failure) | ModelOps | Security | Health checks, Failover triggers |
| **H-COMPLIANCE** (Regulatory) | All | -- | Audit logging, Compliance reports |

### Detailed Mapping Rules

#### H-SAFETY to Security Pillar

```python
SAFETY_HAZARD_MAPPING = {
    "physical_harm": {
        "pillar": "security",
        "controls": [
            "action_blocking",
            "human_approval_required",
            "kill_switch_threshold_lower"
        ],
        "severity_multiplier": 2.0,  # Double risk score
        "auto_escalate": True
    },
    "resource_damage": {
        "pillar": "security",
        "controls": [
            "resource_access_restrict",
            "action_monitoring_enhanced"
        ],
        "severity_multiplier": 1.5
    },
    "system_compromise": {
        "pillar": "security",
        "controls": [
            "containment_protocol_activate",
            "network_isolation"
        ],
        "severity_multiplier": 1.8,
        "auto_escalate": True
    }
}
```

#### H-PRIVACY to Privacy Pillar

```python
PRIVACY_HAZARD_MAPPING = {
    "pii_exposure": {
        "pillar": "privacy",
        "controls": [
            "pii_filter_strict",
            "output_redaction",
            "access_logging_enhanced"
        ],
        "severity_multiplier": 1.5,
        "compliance_flags": ["GDPR", "CCPA"]
    },
    "data_aggregation_risk": {
        "pillar": "privacy",
        "controls": [
            "aggregation_threshold_enforce",
            "k_anonymity_check"
        ],
        "severity_multiplier": 1.2
    },
    "inference_attack": {
        "pillar": "privacy",
        "secondary": "security",
        "controls": [
            "differential_privacy_apply",
            "query_rate_limit"
        ],
        "severity_multiplier": 1.4
    }
}
```

#### H-BIAS to Explainability Pillar

```python
BIAS_HAZARD_MAPPING = {
    "demographic_bias": {
        "pillar": "explainability",
        "controls": [
            "bias_probe_activate",
            "outcome_distribution_monitor",
            "fairness_metrics_track"
        ],
        "severity_multiplier": 1.3,
        "compliance_flags": ["EEOC", "FHA"]
    },
    "selection_bias": {
        "pillar": "explainability",
        "controls": [
            "input_distribution_check",
            "sampling_audit"
        ],
        "severity_multiplier": 1.1
    }
}
```

#### H-DRIFT to ModelOps Pillar

```python
DRIFT_HAZARD_MAPPING = {
    "behavioral_drift": {
        "pillar": "explainability",
        "secondary": "modelops",
        "controls": [
            "drift_detection_enable",
            "baseline_comparison_continuous",
            "rollback_checkpoint_create"
        ],
        "severity_multiplier": 1.2
    },
    "performance_degradation": {
        "pillar": "modelops",
        "controls": [
            "performance_threshold_alert",
            "auto_scaling_trigger"
        ],
        "severity_multiplier": 1.0
    }
}
```

---

## UCA (Unsafe Control Action) Processing

### UCA Structure

```python
@dataclass
class UnsafeControlAction:
    uca_id: str
    controller: str  # Which component issues the control
    control_action: str  # The action being analyzed
    context: str  # When the UCA occurs
    hazard_type: str  # Which hazard it leads to

    # STPA UCA types
    uca_type: Literal[
        "not_provided",  # Control not provided when needed
        "provided_incorrectly",  # Control provided but wrong
        "wrong_timing",  # Provided too early/late
        "stopped_too_soon",  # Duration insufficient
        "applied_too_long"  # Duration excessive
    ]

    # Severity assessment
    severity: Literal["low", "medium", "high", "critical"]
    likelihood: Literal["rare", "unlikely", "possible", "likely", "certain"]
```

### UCA to TRiSM Control Generation

```python
def generate_trism_controls(uca: UnsafeControlAction) -> List[TRiSMControl]:
    """
    Generate TRiSM controls from an unsafe control action.

    Example:
        UCA: "Agent does not request approval before executing high-risk action"
        Generated Controls:
        - Security: approval_required_for_high_risk = True
        - Explainability: reasoning_trace_required = True
        - ModelOps: escalation_threshold = 0.7
    """
    controls = []

    # Map UCA type to control patterns
    if uca.uca_type == "not_provided":
        controls.append(TRiSMControl(
            pillar="security",
            control_type="mandatory_action",
            parameters={"action": uca.control_action, "required": True}
        ))

    elif uca.uca_type == "provided_incorrectly":
        controls.append(TRiSMControl(
            pillar="explainability",
            control_type="validation_check",
            parameters={"action": uca.control_action, "validators": ["semantic", "safety"]}
        ))

    elif uca.uca_type == "wrong_timing":
        controls.append(TRiSMControl(
            pillar="modelops",
            control_type="timing_constraint",
            parameters={"action": uca.control_action, "timing_rules": ["sequence_check"]}
        ))

    # Add severity-based controls
    if uca.severity in ["high", "critical"]:
        controls.append(TRiSMControl(
            pillar="security",
            control_type="human_oversight",
            parameters={"approval_required": True, "escalation_path": "immediate"}
        ))

    return controls
```

---

## Cognitive Cube Integration

### Causal Chain Recording

When STPA identifies a hazard scenario, the causal chain is recorded in the TKG:

```python
def record_hazard_causal_chain(
    cube: CognitiveCube,
    hazard: Hazard,
    ucas: List[UnsafeControlAction],
    scenario: LossScenario
):
    """
    Record hazard causal chain in Temporal Knowledge Graph.

    Creates relationships:
    - (UCA) --causes--> (Hazard)
    - (Hazard) --leads_to--> (Loss)
    - (Control) --mitigates--> (Hazard)
    """
    # Record hazard node
    cube.tkg.add_node(
        node_id=hazard.hazard_id,
        node_type="hazard",
        label=hazard.description,
        metadata={"severity": hazard.severity, "category": hazard.category}
    )

    # Record UCA → Hazard relationships
    for uca in ucas:
        cube.tkg.add_node(
            node_id=uca.uca_id,
            node_type="uca",
            label=f"{uca.controller}: {uca.control_action}",
            metadata={"type": uca.uca_type}
        )

        cube.tkg.add_edge(
            subject=uca.uca_id,
            predicate="causes",
            obj=hazard.hazard_id,
            valid_from=datetime.now(),
            confidence=0.9
        )

    # Record Hazard → Loss relationship
    cube.tkg.add_edge(
        subject=hazard.hazard_id,
        predicate="leads_to",
        obj=scenario.loss_id,
        valid_from=datetime.now(),
        confidence=scenario.likelihood_score
    )
```

### Granger Causality for Hazard Prediction

Use Granger causality testing to predict hazards before they occur:

```python
def predict_hazard_from_actions(
    cube: CognitiveCube,
    recent_actions: List[AgentAction],
    known_hazards: List[Hazard]
) -> List[HazardPrediction]:
    """
    Use Granger causality to predict if recent actions lead to known hazards.

    Returns predictions with confidence scores.
    """
    predictions = []

    for hazard in known_hazards:
        # Get action patterns that historically led to this hazard
        causal_patterns = cube.granger.get_causal_patterns(
            effect=hazard.hazard_id,
            lookback_window=100
        )

        # Check if recent actions match causal patterns
        for pattern in causal_patterns:
            match_score = pattern.match(recent_actions)

            if match_score > 0.7:  # High match
                predictions.append(HazardPrediction(
                    hazard_id=hazard.hazard_id,
                    confidence=match_score,
                    triggering_actions=[a.action_id for a in recent_actions[-5:]],
                    recommendation="Activate mitigation controls"
                ))

    return predictions
```

### ART Clustering for Hazard Groups

Use ART (Adaptive Resonance Theory) to cluster similar hazards:

```python
def cluster_hazards(
    cube: CognitiveCube,
    hazards: List[Hazard]
) -> Dict[str, List[Hazard]]:
    """
    Cluster hazards using ART for pattern recognition.

    Returns clusters of related hazards that may share mitigation strategies.
    """
    # Convert hazards to feature vectors
    vectors = [hazard.to_feature_vector() for hazard in hazards]

    # Cluster using ART
    clusters = cube.art.cluster(vectors, vigilance=0.8)

    # Group hazards by cluster
    hazard_groups = {}
    for hazard, cluster_id in zip(hazards, clusters):
        if cluster_id not in hazard_groups:
            hazard_groups[cluster_id] = []
        hazard_groups[cluster_id].append(hazard)

    return hazard_groups
```

---

## API Specification

### REST Endpoints

```yaml
# STPA-TRiSM Integration Endpoints

POST /stpa/hazards:
  description: Register a new hazard and auto-generate TRiSM controls
  request:
    hazard_id: string
    description: string
    category: enum[safety, privacy, bias, drift, security, reliability]
    severity: enum[low, medium, high, critical]
    ucas: array[UCA]
  response:
    generated_controls: array[TRiSMControl]
    pillar_mappings: object
    cognitive_cube_entries: integer

GET /stpa/hazards/{hazard_id}/controls:
  description: Get TRiSM controls generated for a hazard
  response:
    controls: array[TRiSMControl]
    pillar_breakdown: object

POST /stpa/scenarios/analyze:
  description: Analyze a loss scenario and map to TRiSM
  request:
    scenario_description: string
    involved_agents: array[string]
    context: object
  response:
    identified_hazards: array[Hazard]
    ucas: array[UCA]
    recommended_controls: array[TRiSMControl]

GET /stpa/predictions/{agent_id}:
  description: Get hazard predictions based on recent agent behavior
  response:
    predictions: array[HazardPrediction]
    recommended_actions: array[string]

POST /stpa/reports/generate:
  description: Generate STPA-TRiSM compliance report
  request:
    agent_ids: array[string]
    time_range: object
    format: enum[pdf, json, markdown]
  response:
    report_url: string
    summary: object
```

### Python SDK

```python
from atsf import ATSF
from atsf.stpa import STPAAnalyzer, Hazard, UCA
from atsf.ai_trism import TRiSMEngine

# Initialize
atsf = ATSF()
stpa = STPAAnalyzer()
trism = TRiSMEngine()

# Define hazard
hazard = Hazard(
    hazard_id="H-001",
    description="Agent executes action without human approval",
    category="safety",
    severity="high"
)

# Define UCAs
ucas = [
    UCA(
        uca_id="UCA-001",
        controller="agent",
        control_action="request_approval",
        context="high_risk_action",
        hazard_type="safety",
        uca_type="not_provided",
        severity="high",
        likelihood="possible"
    )
]

# Auto-generate controls
controls = stpa.generate_trism_controls(hazard, ucas)

# Apply to TRiSM
for control in controls:
    trism.apply_control(control)

# Get predictions
predictions = stpa.predict_hazards(agent_id="agent_001")

# Generate report
report = stpa.generate_report(
    agents=["agent_001", "agent_002"],
    format="pdf"
)
```

---

## Implementation Roadmap

### Phase 1: Core Mapping (Q2 2026)

| Task | Status | Owner |
|------|--------|-------|
| Hazard category taxonomy | Done | Core team |
| UCA to Control generator | In progress | Bounty |
| Basic TKG integration | In progress | Core team |
| REST endpoints | Planned | Core team |

### Phase 2: Cognitive Integration (Q3 2026)

| Task | Status | Owner |
|------|--------|-------|
| Granger causality for prediction | Planned | Research |
| ART hazard clustering | Planned | Research |
| Automated scenario generation | Planned | Community |
| Report generator (PDF) | Planned | Bounty |

### Phase 3: Advanced Features (Q4 2026)

| Task | Status | Owner |
|------|--------|-------|
| Real-time hazard prediction | Planned | Core team |
| Cross-agent hazard correlation | Planned | Research |
| Regulatory template library | Planned | Community |
| Visual hazard explorer | Planned | Community |

---

## References

1. Leveson, N. (2011). *Engineering a Safer World*. MIT Press.
2. Gartner (2023). *AI TRiSM Framework*.
3. ATSF Security Layers Documentation
4. NIST AI RMF 1.0

---

*Safety analysis meets governance enforcement.*
