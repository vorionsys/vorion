/**
 * @vorionsys/atsf-core - Agentic Trust Scoring Framework
 *
 * Core runtime for AI agent governance, trust scoring, and policy enforcement.
 *
 * @packageDocumentation
 */

// Common types (core primitives)
export * from './common/types.js';

// BASIS - Rule evaluation engine (exclude EvaluationResult to avoid conflict)
export {
  RuleEvaluator,
  createEvaluator,
} from './basis/evaluator.js';
export {
  parseNamespace,
  validateRule,
  validateNamespace,
} from './basis/parser.js';
export type {
  Rule,
  RuleNamespace,
  RuleCondition as BasisRuleCondition,
  RuleResult,
  EvaluationContext,
  EvaluationResult as BasisEvaluationResult,
} from './basis/types.js';

// Intent service
export * from './intent/index.js';

// Enforcement service
export * from './enforce/index.js';

// Cognigate execution runtime
export * from './cognigate/index.js';

// Proof/audit chain
export * from './proof/index.js';

// CHAIN - Blockchain anchoring (exclude VerificationResult, verifyMerkleProof to avoid conflict with proof module)
export {
  POLYGON_NETWORKS,
  type NetworkName,
  type ChainAnchorConfig,
  type ProofToAnchor,
  type AnchorResult,
  // VerificationResult excluded - already exported from proof
  sha256,
  keccak256Concat,
  computeMerkleRoot,
  computeMerkleProof,
  // verifyMerkleProof excluded - already exported from proof
  MockChainAnchorService,
  createChainAnchor,
} from './chain/index.js';

// Decision Provenance (DPO)
export * from './provenance/index.js';

// Trust Engine
export * from './trust-engine/index.js';

// Typed Security Layers
export * from './layers/index.js';

// Concrete Layer Implementations (L0-L5: Input Validation Tier)
export * from './layers/implementations/index.js';

// Multi-Agent Trust Arbitration
export * from './arbitration/index.js';

// Progressive Containment
export * from './containment/index.js';

// Output Contracts (VorionResponse)
export * from './contracts/index.js';

// Governance & Authority Engine (exclude types already exported from enforce module:
// DecisionTier, FluidDecision, RefinementAction, RefinementOption, RefinementRequest, WorkflowInstance, WorkflowState)
export {
  GovernanceEngine,
  createGovernanceEngine,
  createGovernanceRule,
  createFieldCondition,
  createCompositeCondition,
  createRuleEffect,
} from './governance/index.js';
export type {
  GovernanceRule,
  RuleCategory,
  RuleCondition,
  RuleEffect,
  ConditionOperator,
  Authority,
  GovernanceRequest,
  GovernanceResult,
  EvaluatedRule,
  EffectModification,
  EffectConstraint,
  GovernanceConfig,
  RuleQuery,
  ClarificationRequirement,
} from './governance/types.js';
export {
  FluidWorkflowEngine,
  createFluidWorkflowEngine,
} from './governance/fluid-workflow.js';
export type {
  StateTransition,
  FluidWorkflowConfig,
} from './governance/fluid-workflow.js';

// Persistence layer
export * from './persistence/index.js';

// LangChain integration
export * from './langchain/index.js';

// CrewAI integration
export * from './crewai/index.js';

// Phase 6: Trust Engine Hardening
export * as phase6 from './phase6/index.js';
export {
  createPhase6TrustEngine,
  type Phase6TrustEngine,
  type Phase6Config,
  PHASE6_VERSION,
} from './phase6/index.js';

// Sandbox Adversarial Training Boot Camp
export * from './sandbox-training/index.js';

// Version
export const VERSION = '0.2.2';

// Main entry point for server
export { createServer, startServer } from './api/server.js';
