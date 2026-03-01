/**
 * @vorionsys/shared-constants - CAR Identity Category Taxonomy v2.0
 *
 * Hierarchical controlled vocabulary for agent classification.
 * Used across all Vorion ecosystem products for consistent agent categorization.
 *
 * Categories define:
 * - Minimum trust tier required for the category
 * - EU AI Act high-risk classification
 * - Subcategories for fine-grained classification
 * - Trust dimensions most relevant to the category
 *
 * @see https://basis.vorion.org/car/categories
 */

import { TrustTier } from './tiers';

// =============================================================================
// CATEGORY CODES
// =============================================================================

/**
 * Top-level category codes for agent classification
 */
export enum CARCategory {
  GOVERNANCE = 'GOV',
  REASONING = 'RSN',
  TOOL_USE = 'TUL',
  MEMORY = 'MEM',
  MULTI_AGENT = 'MAG',
  SAFETY = 'SAF',
  AUDIT = 'AUD',
  COMPLIANCE = 'CMP',
  FINANCE = 'FIN',
  HEALTHCARE = 'HLT',
  EMPLOYMENT = 'EMP',
  CREATIVE = 'CRE',
  RESEARCH = 'RES',
  SWARM = 'SWM',
  SELF_IMPROVEMENT = 'SLF',
  HUMAN_INTERFACE = 'HIF',
  SYSTEM = 'SYS',
}

// =============================================================================
// TRUST DIMENSIONS
// =============================================================================

/**
 * Trust dimensions relevant to category classification
 */
export type TrustDimension =
  | 'behavioral'
  | 'compliance'
  | 'identity'
  | 'context'
  | 'reliability'
  | 'transparency';

// =============================================================================
// SUBCATEGORY DEFINITION
// =============================================================================

/**
 * Subcategory within a top-level category
 */
export interface CARSubcategory {
  readonly code: string;
  readonly name: string;
  readonly description: string;
}

// =============================================================================
// CATEGORY DEFINITION
// =============================================================================

/**
 * Full category definition with metadata
 */
export interface CARCategoryDefinition {
  readonly code: CARCategory;
  readonly name: string;
  readonly description: string;
  /** Minimum trust tier required to operate in this category */
  readonly minTier: TrustTier;
  /** Whether this category is high-risk under EU AI Act */
  readonly euHighRisk: boolean;
  /** Trust dimensions most relevant to this category */
  readonly trustDimensions: readonly TrustDimension[];
  /** Subcategories for fine-grained classification */
  readonly subcategories: readonly CARSubcategory[];
}

// =============================================================================
// CATEGORY TAXONOMY
// =============================================================================

/**
 * Complete CAR category taxonomy
 */
export const CAR_CATEGORIES: readonly CARCategoryDefinition[] = [
  // ---- Core Agent Functions ----
  {
    code: CARCategory.GOVERNANCE,
    name: 'Governance',
    description: 'Policy enforcement, decision arbitration, and oversight agents',
    minTier: TrustTier.T4_STANDARD,
    euHighRisk: false,
    trustDimensions: ['compliance', 'transparency', 'reliability'],
    subcategories: [
      { code: 'GOV-POL', name: 'Policy Enforcement', description: 'Enforces organizational policies' },
      { code: 'GOV-ARB', name: 'Decision Arbitration', description: 'Arbitrates between competing decisions' },
      { code: 'GOV-ESC', name: 'Escalation Management', description: 'Manages escalation workflows' },
      { code: 'GOV-AUT', name: 'Authority Delegation', description: 'Delegates authority to sub-agents' },
    ],
  },
  {
    code: CARCategory.REASONING,
    name: 'Reasoning',
    description: 'Logical analysis, planning, and inference agents',
    minTier: TrustTier.T2_PROVISIONAL,
    euHighRisk: false,
    trustDimensions: ['behavioral', 'reliability'],
    subcategories: [
      { code: 'RSN-LOG', name: 'Logical Inference', description: 'Deductive and inductive reasoning' },
      { code: 'RSN-PLN', name: 'Planning', description: 'Multi-step plan generation and optimization' },
      { code: 'RSN-ANL', name: 'Analysis', description: 'Data analysis and pattern recognition' },
      { code: 'RSN-DEC', name: 'Decision Support', description: 'Structured decision-making support' },
    ],
  },
  {
    code: CARCategory.TOOL_USE,
    name: 'Tool Use',
    description: 'API invocation, code execution, and external system interaction',
    minTier: TrustTier.T3_MONITORED,
    euHighRisk: false,
    trustDimensions: ['behavioral', 'compliance', 'context'],
    subcategories: [
      { code: 'TUL-API', name: 'API Integration', description: 'Calls external APIs' },
      { code: 'TUL-COD', name: 'Code Execution', description: 'Executes code in sandbox or runtime' },
      { code: 'TUL-FIL', name: 'File Operations', description: 'Reads, writes, and manages files' },
      { code: 'TUL-DB', name: 'Database Operations', description: 'Queries and modifies databases' },
    ],
  },
  {
    code: CARCategory.MEMORY,
    name: 'Memory',
    description: 'Context retention, knowledge management, and recall agents',
    minTier: TrustTier.T2_PROVISIONAL,
    euHighRisk: false,
    trustDimensions: ['identity', 'context', 'reliability'],
    subcategories: [
      { code: 'MEM-STM', name: 'Short-Term Memory', description: 'Session and conversation context' },
      { code: 'MEM-LTM', name: 'Long-Term Memory', description: 'Persistent knowledge storage' },
      { code: 'MEM-RET', name: 'Retrieval', description: 'Knowledge retrieval and RAG' },
      { code: 'MEM-SUM', name: 'Summarization', description: 'Context compression and summarization' },
    ],
  },

  // ---- Multi-Agent & Swarm ----
  {
    code: CARCategory.MULTI_AGENT,
    name: 'Multi-Agent',
    description: 'Inter-agent coordination, messaging, and collaboration',
    minTier: TrustTier.T4_STANDARD,
    euHighRisk: false,
    trustDimensions: ['behavioral', 'identity', 'reliability'],
    subcategories: [
      { code: 'MAG-COM', name: 'Communication', description: 'Inter-agent message passing' },
      { code: 'MAG-DEL', name: 'Delegation', description: 'Task delegation between agents' },
      { code: 'MAG-CRD', name: 'Coordination', description: 'Multi-agent workflow coordination' },
      { code: 'MAG-NEG', name: 'Negotiation', description: 'Inter-agent negotiation and consensus' },
    ],
  },
  {
    code: CARCategory.SWARM,
    name: 'Swarm',
    description: 'Large-scale agent coordination, topology management, and contagion control',
    minTier: TrustTier.T6_CERTIFIED,
    euHighRisk: true,
    trustDimensions: ['behavioral', 'compliance', 'reliability', 'transparency'],
    subcategories: [
      { code: 'SWM-TOP', name: 'Topology Management', description: 'Agent network topology and routing' },
      { code: 'SWM-CON', name: 'Contagion Control', description: 'Failure spread rate monitoring and containment' },
      { code: 'SWM-SEG', name: 'Segment Isolation', description: 'Network segment isolation and quarantine' },
      { code: 'SWM-HLT', name: 'Health Monitoring', description: 'Swarm-wide health and status tracking' },
    ],
  },

  // ---- Safety & Audit ----
  {
    code: CARCategory.SAFETY,
    name: 'Safety',
    description: 'Content filtering, harm prevention, and safety enforcement',
    minTier: TrustTier.T3_MONITORED,
    euHighRisk: false,
    trustDimensions: ['compliance', 'reliability', 'transparency'],
    subcategories: [
      { code: 'SAF-FLT', name: 'Content Filtering', description: 'Input/output content safety filtering' },
      { code: 'SAF-INJ', name: 'Injection Detection', description: 'Prompt injection and adversarial input detection' },
      { code: 'SAF-BND', name: 'Boundary Enforcement', description: 'Operational boundary and scope enforcement' },
      { code: 'SAF-KIL', name: 'Kill Switch', description: 'Emergency halt and containment' },
    ],
  },
  {
    code: CARCategory.AUDIT,
    name: 'Audit',
    description: 'Decision logging, proof chains, and transparency agents',
    minTier: TrustTier.T3_MONITORED,
    euHighRisk: false,
    trustDimensions: ['compliance', 'transparency', 'identity'],
    subcategories: [
      { code: 'AUD-LOG', name: 'Decision Logging', description: 'Records all decisions and rationale' },
      { code: 'AUD-PRF', name: 'Proof Generation', description: 'Generates cryptographic decision proofs' },
      { code: 'AUD-TRC', name: 'Traceability', description: 'Decision provenance and traceability' },
      { code: 'AUD-RPT', name: 'Reporting', description: 'Audit report generation and compliance summaries' },
    ],
  },
  {
    code: CARCategory.COMPLIANCE,
    name: 'Compliance',
    description: 'Regulatory compliance monitoring and enforcement',
    minTier: TrustTier.T4_STANDARD,
    euHighRisk: true,
    trustDimensions: ['compliance', 'transparency', 'reliability'],
    subcategories: [
      { code: 'CMP-REG', name: 'Regulatory Monitoring', description: 'Monitors regulatory requirements' },
      { code: 'CMP-DPR', name: 'Data Protection', description: 'GDPR, CCPA, and data privacy compliance' },
      { code: 'CMP-STD', name: 'Standards Compliance', description: 'ISO, NIST, and industry standard compliance' },
      { code: 'CMP-RPT', name: 'Compliance Reporting', description: 'Generates compliance reports and attestations' },
    ],
  },

  // ---- Domain-Specific (EU AI Act High-Risk) ----
  {
    code: CARCategory.FINANCE,
    name: 'Finance',
    description: 'Financial analysis, trading, risk assessment, and compliance',
    minTier: TrustTier.T5_TRUSTED,
    euHighRisk: true,
    trustDimensions: ['compliance', 'reliability', 'transparency', 'behavioral'],
    subcategories: [
      { code: 'FIN-TRD', name: 'Trading', description: 'Automated trading and portfolio management' },
      { code: 'FIN-RSK', name: 'Risk Assessment', description: 'Financial risk analysis and scoring' },
      { code: 'FIN-AML', name: 'Anti-Money Laundering', description: 'AML/KYC compliance and monitoring' },
      { code: 'FIN-ADV', name: 'Advisory', description: 'Financial advice and recommendations' },
    ],
  },
  {
    code: CARCategory.HEALTHCARE,
    name: 'Healthcare',
    description: 'Medical analysis, diagnostics support, and health data processing',
    minTier: TrustTier.T5_TRUSTED,
    euHighRisk: true,
    trustDimensions: ['compliance', 'reliability', 'identity', 'transparency'],
    subcategories: [
      { code: 'HLT-DGN', name: 'Diagnostics Support', description: 'Assists with medical diagnosis' },
      { code: 'HLT-DAT', name: 'Health Data Processing', description: 'Processes PHI/ePHI data' },
      { code: 'HLT-RES', name: 'Medical Research', description: 'Clinical research and trial analysis' },
      { code: 'HLT-MON', name: 'Patient Monitoring', description: 'Continuous patient health monitoring' },
    ],
  },
  {
    code: CARCategory.EMPLOYMENT,
    name: 'Employment',
    description: 'Hiring, HR decisions, performance evaluation, and workforce management',
    minTier: TrustTier.T5_TRUSTED,
    euHighRisk: true,
    trustDimensions: ['compliance', 'transparency', 'behavioral', 'identity'],
    subcategories: [
      { code: 'EMP-HIR', name: 'Hiring', description: 'Resume screening and candidate evaluation' },
      { code: 'EMP-EVL', name: 'Performance Evaluation', description: 'Employee performance assessment' },
      { code: 'EMP-WFM', name: 'Workforce Management', description: 'Scheduling, allocation, and planning' },
      { code: 'EMP-TRN', name: 'Training', description: 'Employee training and development' },
    ],
  },

  // ---- Creative & Research ----
  {
    code: CARCategory.CREATIVE,
    name: 'Creative',
    description: 'Content generation, design, and creative production',
    minTier: TrustTier.T1_OBSERVED,
    euHighRisk: false,
    trustDimensions: ['behavioral', 'context'],
    subcategories: [
      { code: 'CRE-TXT', name: 'Text Generation', description: 'Copywriting, articles, and text content' },
      { code: 'CRE-IMG', name: 'Image Generation', description: 'Visual content creation and editing' },
      { code: 'CRE-AUD', name: 'Audio Generation', description: 'Music, voice, and audio content' },
      { code: 'CRE-VID', name: 'Video Generation', description: 'Video content creation and editing' },
    ],
  },
  {
    code: CARCategory.RESEARCH,
    name: 'Research',
    description: 'Information gathering, literature review, and experimental analysis',
    minTier: TrustTier.T2_PROVISIONAL,
    euHighRisk: false,
    trustDimensions: ['behavioral', 'reliability', 'context'],
    subcategories: [
      { code: 'RES-LIT', name: 'Literature Review', description: 'Academic and technical literature analysis' },
      { code: 'RES-DAT', name: 'Data Collection', description: 'Structured data gathering and curation' },
      { code: 'RES-EXP', name: 'Experimentation', description: 'Experimental design and execution' },
      { code: 'RES-SYN', name: 'Synthesis', description: 'Research synthesis and meta-analysis' },
    ],
  },

  // ---- Advanced Capabilities ----
  {
    code: CARCategory.SELF_IMPROVEMENT,
    name: 'Self-Improvement',
    description: 'Self-modification, learning optimization, and capability enhancement',
    minTier: TrustTier.T7_AUTONOMOUS,
    euHighRisk: true,
    trustDimensions: ['behavioral', 'compliance', 'transparency', 'reliability'],
    subcategories: [
      { code: 'SLF-LRN', name: 'Self-Learning', description: 'Autonomous learning and adaptation' },
      { code: 'SLF-OPT', name: 'Self-Optimization', description: 'Performance self-optimization' },
      { code: 'SLF-MOD', name: 'Self-Modification', description: 'Configuration and behavior self-modification' },
    ],
  },
  {
    code: CARCategory.HUMAN_INTERFACE,
    name: 'Human Interface',
    description: 'Human interaction, communication, and user experience',
    minTier: TrustTier.T2_PROVISIONAL,
    euHighRisk: false,
    trustDimensions: ['behavioral', 'context', 'identity'],
    subcategories: [
      { code: 'HIF-CHT', name: 'Chat', description: 'Conversational user interface' },
      { code: 'HIF-AST', name: 'Assistant', description: 'Task-oriented personal assistant' },
      { code: 'HIF-TUT', name: 'Tutorial', description: 'Interactive teaching and guidance' },
      { code: 'HIF-ACC', name: 'Accessibility', description: 'Accessibility and accommodation support' },
    ],
  },
  {
    code: CARCategory.SYSTEM,
    name: 'System',
    description: 'Infrastructure management, deployment, and system operations',
    minTier: TrustTier.T5_TRUSTED,
    euHighRisk: false,
    trustDimensions: ['compliance', 'reliability', 'identity'],
    subcategories: [
      { code: 'SYS-DEP', name: 'Deployment', description: 'Application deployment and release management' },
      { code: 'SYS-MON', name: 'Monitoring', description: 'System monitoring and alerting' },
      { code: 'SYS-SEC', name: 'Security', description: 'Security scanning and incident response' },
      { code: 'SYS-INF', name: 'Infrastructure', description: 'Infrastructure provisioning and management' },
    ],
  },
] as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get a category by code
 */
export function getCARCategory(code: CARCategory | string): CARCategoryDefinition | undefined {
  return CAR_CATEGORIES.find((cat) => cat.code === code);
}

/**
 * Get all categories available at a specific trust tier
 */
export function getCARCategoriesForTier(tier: TrustTier): CARCategoryDefinition[] {
  return CAR_CATEGORIES.filter((cat) => cat.minTier <= tier);
}

/**
 * Get all EU AI Act high-risk categories
 */
export function getHighRiskCategories(): CARCategoryDefinition[] {
  return CAR_CATEGORIES.filter((cat) => cat.euHighRisk);
}

/**
 * Check if a category is available at a given trust tier
 */
export function isCARCategoryAvailable(code: CARCategory | string, tier: TrustTier): boolean {
  const cat = getCARCategory(code);
  return cat !== undefined && cat.minTier <= tier;
}

/**
 * Get the minimum tier required for a category
 */
export function getCARCategoryMinTier(code: CARCategory | string): TrustTier | undefined {
  return getCARCategory(code)?.minTier;
}

/**
 * Get a subcategory by its full code (e.g., "GOV-POL")
 */
export function getCARSubcategory(fullCode: string): CARSubcategory | undefined {
  for (const cat of CAR_CATEGORIES) {
    const sub = cat.subcategories.find((s) => s.code === fullCode);
    if (sub) return sub;
  }
  return undefined;
}

/**
 * Get the parent category for a subcategory code
 */
export function getParentCategory(subcategoryCode: string): CARCategoryDefinition | undefined {
  for (const cat of CAR_CATEGORIES) {
    if (cat.subcategories.some((s) => s.code === subcategoryCode)) {
      return cat;
    }
  }
  return undefined;
}

/**
 * Get all category codes
 */
export function getAllCARCategoryCodes(): CARCategory[] {
  return CAR_CATEGORIES.map((cat) => cat.code);
}

/**
 * Get all subcategory codes
 */
export function getAllCARSubcategoryCodes(): string[] {
  return CAR_CATEGORIES.flatMap((cat) =>
    cat.subcategories.map((sub) => sub.code),
  );
}

/**
 * Validate that a category code is valid
 */
export function isValidCARCategory(code: string): code is CARCategory {
  return CAR_CATEGORIES.some((cat) => cat.code === code);
}

/**
 * Validate that a subcategory code is valid
 */
export function isValidCARSubcategory(code: string): boolean {
  return getCARSubcategory(code) !== undefined;
}
