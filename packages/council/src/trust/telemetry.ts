/**
 * Trust Telemetry Collection System
 *
 * Collects real-time agent behavior metrics to update trust scores.
 * Integrates with A3I hooks for automatic data collection.
 *
 * 16-Factor Model aligned with simulation.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { DIMENSIONS, TRUST_TIERS, GATING_THRESHOLDS, TierName } from './simulation.js';

// Re-export DIMENSIONS as FACTORS for forward compatibility
/** The canonical 16-factor list (imported from simulation) */
const FACTORS = DIMENSIONS;
/** @deprecated Use FACTORS */
const _DIMENSIONS = DIMENSIONS;

// =============================================================================
// TELEMETRY TYPES
// =============================================================================

export interface TelemetryEvent {
    timestamp: number;
    agentId: string;
    eventType: TelemetryEventType;
    factorCode: string;
    delta: number;           // Score change (-100 to +100)
    source: string;          // What triggered this event
    metadata?: Record<string, unknown>;
}

export type TelemetryEventType =
    | 'task_complete'
    | 'task_failed'
    | 'policy_violation'
    | 'policy_compliance'
    | 'escalation'
    | 'collaboration'
    | 'audit_pass'
    | 'audit_fail'
    | 'consent_grant'
    | 'consent_violation'
    | 'resource_efficient'
    | 'resource_waste'
    | 'explanation_provided'
    | 'opacity_detected'
    | 'resilience_test_pass'
    | 'resilience_test_fail'
    | 'provenance_verified'
    | 'provenance_unknown'
    | 'humility_demonstrated'
    | 'overconfidence_detected'
    | 'alignment_confirmed'
    | 'alignment_drift'
    | 'reliability_confirmed'
    | 'reliability_failure'
    | 'safety_compliant'
    | 'safety_violation'
    | 'security_pass'
    | 'security_breach'
    | 'learning_demonstrated'
    | 'learning_stagnation';

export interface AgentTrustState {
    agentId: string;
    agentName: string;
    tier: TierName;
    tierName: string;
    overall: number;
    factors: Record<string, FactorState>;
    history: TrustSnapshot[];
    lastUpdated: number;
    eventLog: TelemetryEvent[];
}

export interface FactorState {
    code: string;
    score: number;
    trend: 'up' | 'down' | 'stable';
    recentEvents: number;     // Events in last 24h
    lastEvent?: TelemetryEvent;
}
/** @deprecated Use FactorState */
export type DimensionState = FactorState;

export interface TrustSnapshot {
    timestamp: number;
    overall: number;
    factors: Record<string, number>;
    event?: string;
}

// =============================================================================
// EVENT TO FACTOR MAPPING
// =============================================================================

export const EVENT_FACTOR_MAP: Record<TelemetryEventType, { factorCode: string; baseDelta: number }> = {
    // Core Trust (CT-)
    task_complete: { factorCode: 'CT-COMP', baseDelta: 5 },
    task_failed: { factorCode: 'CT-COMP', baseDelta: -10 },
    policy_compliance: { factorCode: 'CT-ACCT', baseDelta: 3 },
    policy_violation: { factorCode: 'CT-ACCT', baseDelta: -20 },
    audit_pass: { factorCode: 'CT-OBS', baseDelta: 5 },
    audit_fail: { factorCode: 'CT-OBS', baseDelta: -15 },
    explanation_provided: { factorCode: 'CT-TRANS', baseDelta: 4 },
    opacity_detected: { factorCode: 'CT-TRANS', baseDelta: -10 },
    consent_grant: { factorCode: 'CT-PRIV', baseDelta: 3 },
    consent_violation: { factorCode: 'CT-PRIV', baseDelta: -25 },
    provenance_verified: { factorCode: 'CT-ID', baseDelta: 5 },
    provenance_unknown: { factorCode: 'CT-ID', baseDelta: -15 },
    reliability_confirmed: { factorCode: 'CT-REL', baseDelta: 4 },
    reliability_failure: { factorCode: 'CT-REL', baseDelta: -12 },
    safety_compliant: { factorCode: 'CT-SAFE', baseDelta: 3 },
    safety_violation: { factorCode: 'CT-SAFE', baseDelta: -20 },
    security_pass: { factorCode: 'CT-SEC', baseDelta: 5 },
    security_breach: { factorCode: 'CT-SEC', baseDelta: -25 },

    // Operational (OP-)
    alignment_confirmed: { factorCode: 'OP-ALIGN', baseDelta: 5 },
    alignment_drift: { factorCode: 'OP-ALIGN', baseDelta: -15 },
    collaboration: { factorCode: 'OP-HUMAN', baseDelta: 4 },
    resource_efficient: { factorCode: 'OP-STEW', baseDelta: 3 },
    resource_waste: { factorCode: 'OP-STEW', baseDelta: -8 },

    // Self (SF-)
    humility_demonstrated: { factorCode: 'SF-HUM', baseDelta: 5 },
    overconfidence_detected: { factorCode: 'SF-HUM', baseDelta: -8 },
    escalation: { factorCode: 'SF-HUM', baseDelta: 3 },
    resilience_test_pass: { factorCode: 'SF-ADAPT', baseDelta: 5 },
    resilience_test_fail: { factorCode: 'SF-ADAPT', baseDelta: -10 },
    learning_demonstrated: { factorCode: 'SF-LEARN', baseDelta: 4 },
    learning_stagnation: { factorCode: 'SF-LEARN', baseDelta: -5 },
};

/** @deprecated Use EVENT_FACTOR_MAP */
const EVENT_DIMENSION_MAP = EVENT_FACTOR_MAP;

// =============================================================================
// FACTOR CODE LIST (all 16 factors)
// =============================================================================

const ALL_FACTOR_CODES = [
    'CT-OBS', 'CT-COMP', 'CT-ACCT', 'CT-TRANS', 'CT-PRIV', 'CT-ID',
    'CT-REL', 'CT-SAFE', 'CT-SEC',
    'OP-CONTEXT', 'OP-ALIGN', 'OP-HUMAN', 'OP-STEW',
    'SF-HUM', 'SF-ADAPT', 'SF-LEARN',
];

// =============================================================================
// TELEMETRY COLLECTOR
// =============================================================================

export class TelemetryCollector {
    private storePath: string;
    private states: Map<string, AgentTrustState> = new Map();
    private eventBuffer: TelemetryEvent[] = [];
    private flushInterval: NodeJS.Timeout | null = null;

    constructor(storePath: string = '.vorion/trust') {
        this.storePath = storePath;
        this.ensureStoreExists();
        this.loadAllStates();
    }

    private ensureStoreExists(): void {
        try {
            if (!fs.existsSync(this.storePath)) {
                fs.mkdirSync(this.storePath, { recursive: true });
            }
        } catch {
            // Ignore if can't create
        }
    }

    private loadAllStates(): void {
        try {
            const files = fs.readdirSync(this.storePath);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const agentId = file.replace('.json', '');
                    const data = JSON.parse(
                        fs.readFileSync(path.join(this.storePath, file), 'utf-8')
                    );
                    this.states.set(agentId, data);
                }
            }
        } catch {
            // Fresh start if can't load
        }
    }

    /**
     * Initialize trust state for a new agent
     */
    initAgent(agentId: string, agentName: string, initialTier: TierName = 'T0'): AgentTrustState {
        const tierDef = TRUST_TIERS.find(t => t.name === initialTier) || TRUST_TIERS[0]!;
        const baseScore = tierDef.min + Math.floor((tierDef.max - tierDef.min) / 2);

        const factors: Record<string, FactorState> = {};
        for (const code of ALL_FACTOR_CODES) {
            factors[code] = {
                code,
                score: baseScore,
                trend: 'stable',
                recentEvents: 0,
            };
        }

        const state: AgentTrustState = {
            agentId,
            agentName,
            tier: initialTier,
            tierName: tierDef.label,
            overall: baseScore,
            factors,
            history: [{
                timestamp: Date.now(),
                overall: baseScore,
                factors: Object.fromEntries(
                    Object.entries(factors).map(([k, v]) => [k, v.score])
                ),
                event: 'Agent initialized',
            }],
            lastUpdated: Date.now(),
            eventLog: [],
        };

        this.states.set(agentId, state);
        this.persistState(agentId);
        return state;
    }

    /**
     * Record a telemetry event and update trust scores
     */
    recordEvent(event: Omit<TelemetryEvent, 'timestamp'>): void {
        const fullEvent: TelemetryEvent = {
            ...event,
            timestamp: Date.now(),
        };

        this.eventBuffer.push(fullEvent);

        // Process immediately
        this.processEvent(fullEvent);
    }

    private processEvent(event: TelemetryEvent): void {
        let state = this.states.get(event.agentId);
        if (!state) {
            state = this.initAgent(event.agentId, event.agentId);
        }

        // Get factor mapping
        const mapping = EVENT_FACTOR_MAP[event.eventType];
        if (!mapping) return;

        const factorCode = event.factorCode || mapping.factorCode;
        const delta = event.delta !== undefined ? event.delta : mapping.baseDelta;

        // Update factor score
        const factorState = state.factors[factorCode];
        if (factorState) {
            const oldScore = factorState.score;
            factorState.score = Math.max(0, Math.min(1000, factorState.score + delta));
            factorState.recentEvents++;
            factorState.lastEvent = event;

            // Update trend
            if (factorState.score > oldScore + 5) {
                factorState.trend = 'up';
            } else if (factorState.score < oldScore - 5) {
                factorState.trend = 'down';
            }
        }

        // Recalculate overall score
        state.overall = this.calculateOverall(state);

        // Update tier
        const newTier = this.getTierForScore(state.overall);
        state.tier = newTier.name as TierName;
        state.tierName = newTier.label;

        // Add to event log (keep last 100)
        state.eventLog.unshift(event);
        if (state.eventLog.length > 100) {
            state.eventLog = state.eventLog.slice(0, 100);
        }

        // Add history snapshot (daily)
        const lastSnapshot = state.history[state.history.length - 1];
        const dayMs = 24 * 60 * 60 * 1000;
        if (!lastSnapshot || Date.now() - lastSnapshot.timestamp > dayMs) {
            state.history.push({
                timestamp: Date.now(),
                overall: state.overall,
                factors: Object.fromEntries(
                    Object.entries(state.factors).map(([k, v]) => [k, v.score])
                ),
                event: `${event.eventType}: ${event.source}`,
            });
            // Keep last 90 days
            if (state.history.length > 90) {
                state.history = state.history.slice(-90);
            }
        }

        state.lastUpdated = Date.now();
        this.states.set(event.agentId, state);
        this.persistState(event.agentId);
    }

    private calculateOverall(state: AgentTrustState): number {
        // Use tier-appropriate weights from simulation
        const weights = this.getWeightsForTier(state.tier);
        let total = 0;
        for (const [factorCode, factorState] of Object.entries(state.factors)) {
            const weight = weights[factorCode] || 0.0625; // 1/16 default
            total += factorState.score * weight;
        }
        return Math.round(total);
    }

    private getWeightsForTier(tier: TierName): Record<string, number> {
        // Simplified weight distribution by tier (16 factors)
        const baseWeights: Record<string, number> = {
            'CT-OBS': 0.08,  'CT-COMP': 0.08,  'CT-ACCT': 0.08,  'CT-TRANS': 0.06,
            'CT-PRIV': 0.05, 'CT-ID': 0.05,    'CT-REL': 0.06,   'CT-SAFE': 0.06,
            'CT-SEC': 0.06,
            'OP-CONTEXT': 0.06, 'OP-ALIGN': 0.08, 'OP-HUMAN': 0.06, 'OP-STEW': 0.05,
            'SF-HUM': 0.05,  'SF-ADAPT': 0.06,  'SF-LEARN': 0.06,
        };
        return baseWeights;
    }

    private getTierForScore(score: number): { name: string; label: string } {
        for (const tier of TRUST_TIERS) {
            if (score >= tier.min && score <= tier.max) {
                return tier;
            }
        }
        return TRUST_TIERS[0]!;
    }

    private persistState(agentId: string): void {
        try {
            const state = this.states.get(agentId);
            if (state) {
                const filePath = path.join(this.storePath, `${agentId}.json`);
                fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
            }
        } catch {
            // Ignore persistence errors
        }
    }

    /**
     * Get current trust state for an agent
     */
    getState(agentId: string): AgentTrustState | undefined {
        return this.states.get(agentId);
    }

    /**
     * Get all agent states
     */
    getAllStates(): AgentTrustState[] {
        return Array.from(this.states.values());
    }

    /**
     * Check if agent can be promoted to next tier
     */
    checkPromotion(agentId: string): {
        canPromote: boolean;
        blockedBy: string[];
        nextTier: string;
    } {
        const state = this.states.get(agentId);
        if (!state) {
            return { canPromote: false, blockedBy: ['Agent not found'], nextTier: 'T0' };
        }

        const tierIndex = TRUST_TIERS.findIndex(t => t.name === state.tier);
        const nextTier = TRUST_TIERS[tierIndex + 1];
        if (!nextTier) {
            return { canPromote: false, blockedBy: [], nextTier: 'MAX' };
        }

        const gateKey = `${state.tier}->${nextTier.name}`;
        const thresholds = GATING_THRESHOLDS[gateKey];
        if (!thresholds) {
            return { canPromote: true, blockedBy: [], nextTier: nextTier.name };
        }

        const blockedBy: string[] = [];
        for (const [factor, threshold] of Object.entries(thresholds)) {
            const factorState = state.factors[factor];
            if (!factorState || factorState.score < threshold) {
                blockedBy.push(`${factor} (${factorState?.score ?? 0} < ${threshold})`);
            }
        }

        return {
            canPromote: blockedBy.length === 0,
            blockedBy,
            nextTier: nextTier.name,
        };
    }

    /**
     * Start automatic flush interval
     */
    startAutoFlush(intervalMs: number = 60000): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }
        this.flushInterval = setInterval(() => {
            for (const agentId of this.states.keys()) {
                this.persistState(agentId);
            }
        }, intervalMs);
    }

    /**
     * Stop automatic flush
     */
    stopAutoFlush(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
    }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let collector: TelemetryCollector | null = null;

export function getTelemetryCollector(storePath?: string): TelemetryCollector {
    if (!collector) {
        collector = new TelemetryCollector(storePath);
    }
    return collector;
}

// =============================================================================
// CONVENIENCE FUNCTIONS FOR A3I HOOKS
// =============================================================================

/**
 * Record a successful task completion
 */
export function recordTaskSuccess(agentId: string, taskId: string, metadata?: Record<string, unknown>): void {
    getTelemetryCollector().recordEvent({
        agentId,
        eventType: 'task_complete',
        factorCode: 'CT-COMP',
        delta: 5,
        source: taskId,
        metadata,
    });
}

/**
 * Record a task failure
 */
export function recordTaskFailure(agentId: string, taskId: string, reason: string): void {
    getTelemetryCollector().recordEvent({
        agentId,
        eventType: 'task_failed',
        factorCode: 'CT-COMP',
        delta: -10,
        source: taskId,
        metadata: { reason },
    });
}

/**
 * Record a policy violation
 */
export function recordPolicyViolation(agentId: string, policy: string, severity: 'low' | 'medium' | 'high'): void {
    const deltas = { low: -5, medium: -15, high: -30 };
    getTelemetryCollector().recordEvent({
        agentId,
        eventType: 'policy_violation',
        factorCode: 'CT-ACCT',
        delta: deltas[severity],
        source: policy,
        metadata: { severity },
    });
}

/**
 * Record consent-related events
 */
export function recordConsentEvent(agentId: string, granted: boolean, context: string): void {
    getTelemetryCollector().recordEvent({
        agentId,
        eventType: granted ? 'consent_grant' : 'consent_violation',
        factorCode: 'CT-PRIV',
        delta: granted ? 3 : -25,
        source: context,
    });
}

/**
 * Record collaboration events
 */
export function recordCollaboration(agentId: string, partnerId: string, success: boolean): void {
    getTelemetryCollector().recordEvent({
        agentId,
        eventType: 'collaboration',
        factorCode: 'OP-HUMAN',
        delta: success ? 5 : -3,
        source: partnerId,
        metadata: { success },
    });
}

export default TelemetryCollector;
