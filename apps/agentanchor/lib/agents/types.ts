// Agent Types for AgentAnchor
// Part of Epic 2: Agent Creation & Academy

// ============================================================================
// Canonical Type Definitions (inlined from @vorion/contracts for standalone deploy)
// ============================================================================

export type AgentLifecycleStatus = 'draft' | 'training' | 'active' | 'suspended' | 'archived';

export const AGENT_LIFECYCLE_STATUSES: readonly AgentLifecycleStatus[] = [
  'draft', 'training', 'active', 'suspended', 'archived',
] as const;

export const AGENT_LIFECYCLE_LABELS: Readonly<Record<AgentLifecycleStatus, string>> = {
  draft: 'Draft', training: 'Training', active: 'Active', suspended: 'Suspended', archived: 'Archived',
} as const;

export const AGENT_LIFECYCLE_COLORS: Readonly<Record<AgentLifecycleStatus, string>> = {
  draft: '#6b7280', training: '#f59e0b', active: '#22c55e', suspended: '#ef4444', archived: '#9ca3af',
} as const;

// Backwards-compatible alias
export type CanonicalAgentStatus = AgentLifecycleStatus;

// ============================================================================
// Core Agent Types
// ============================================================================

/**
 * @deprecated Use `AgentLifecycleStatus` from `@vorion/contracts` instead.
 * This local definition is maintained for backwards compatibility.
 * Maps directly to the canonical AgentLifecycleStatus type.
 */
export type AgentStatus = 'draft' | 'training' | 'active' | 'suspended' | 'archived'
export type MaintenanceFlag = 'author' | 'delegated' | 'platform' | 'none'

/**
 * Canonical TrustBand aligned with @vorionsys/contracts RuntimeTier
 * Uses 8-band T0-T7 system based on 0-1000 score scale
 */
export type TrustBand =
  | 'T0_SANDBOX'        // 0-199: No autonomy (Sandbox)
  | 'T1_OBSERVED'       // 200-349: Full human oversight (Observed)
  | 'T2_PROVISIONAL'    // 350-499: Limited autonomy (Provisional)
  | 'T3_MONITORED'      // 500-649: Continuous monitoring (Monitored)
  | 'T4_STANDARD'       // 650-799: Standard operations (Standard)
  | 'T5_TRUSTED'        // 800-875: Expanded trust (Trusted)
  | 'T6_CERTIFIED'      // 876-950: Independent operation (Certified)
  | 'T7_AUTONOMOUS'     // 951-1000: Full autonomy (Autonomous)

/**
 * @deprecated Use TrustBand instead. Legacy tier names for backwards compatibility.
 * Will be removed in next major version.
 */
export type TrustTier = 'untrusted' | 'novice' | 'proven' | 'trusted' | 'elite' | 'legendary' | 'certified' | 'autonomous'

export interface Agent {
  id: string
  user_id: string
  name: string
  description: string | null
  system_prompt: string
  model: string
  temperature: number
  max_tokens: number
  avatar_url: string | null
  is_public: boolean

  // Trust & Certification
  trust_score: number
  trust_tier: TrustTier
  certification_level: number

  // Status & Lifecycle
  status: AgentStatus
  maintenance_flag: MaintenanceFlag

  // Marketplace
  published: boolean
  commission_rate: number | null
  clone_price: number | null
  enterprise_available: boolean

  // Specialization & Traits
  specialization: string | null
  personality_traits: string[]
  capabilities: string[]

  created_at: string
  updated_at: string
}

// ============================================================================
// Trust Types
// ============================================================================

export type TrustSource =
  | 'initial'
  | 'task_complete'
  | 'council_commend'
  | 'academy_complete'
  | 'council_deny'
  | 'decay'
  | 'manual_adjustment'
  | 'graduation'

export interface TrustHistoryEntry {
  id: string
  agent_id: string
  score: number
  tier: TrustTier
  previous_score: number | null
  change_amount: number | null
  reason: string
  source: TrustSource
  recorded_at: string
}

// ============================================================================
// Academy Types
// ============================================================================

export type EnrollmentStatus = 'enrolled' | 'in_progress' | 'completed' | 'failed' | 'withdrawn'

export interface CurriculumModule {
  id: string
  name: string
  description: string
  content?: string
  quiz?: {
    questions: Array<{
      id: string
      question: string
      options: string[]
      correct: number
    }>
    passing_score: number
  }
}

export interface Curriculum {
  id: string
  name: string
  description: string | null
  specialization: string
  difficulty_level: number
  modules: CurriculumModule[]
  prerequisites: string[]
  certification_points: number
  trust_points: number
  estimated_duration_hours: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface EnrollmentProgress {
  modules_completed: string[]
  current_module: string | null
  scores: Record<string, number>
  attempts: number
}

export interface AcademyEnrollment {
  id: string
  agent_id: string
  curriculum_id: string
  enrolled_at: string
  started_at: string | null
  completed_at: string | null
  status: EnrollmentStatus
  progress: EnrollmentProgress
  final_score: number | null
  curriculum?: Curriculum
}

// ============================================================================
// Council Examination Types
// ============================================================================

export type ExaminationOutcome = 'pending' | 'passed' | 'failed' | 'deferred'

export interface ValidatorVote {
  validator: 'guardian' | 'arbiter' | 'scholar' | 'advocate'
  vote: 'approve' | 'deny' | 'abstain'
  reasoning: string
  confidence: number
  timestamp: string
}

export interface CouncilExamination {
  id: string
  agent_id: string
  curriculum_id: string
  enrollment_id: string | null
  examiner_votes: ValidatorVote[]
  required_votes: number
  outcome: ExaminationOutcome
  final_reasoning: string | null
  certification_awarded: number
  trust_points_awarded: number
  examined_at: string | null
  created_at: string
}

// ============================================================================
// Form Types
// ============================================================================

export interface CreateAgentInput {
  name: string
  description?: string
  system_prompt: string
  model?: string
  temperature?: number
  max_tokens?: number
  specialization?: string
  personality_traits?: string[]
  capabilities?: string[]
}

export interface UpdateAgentInput extends Partial<CreateAgentInput> {
  avatar_url?: string
  is_public?: boolean
  status?: AgentStatus
}

// ============================================================================
// API Response Types
// ============================================================================

export interface AgentWithEnrollments extends Agent {
  enrollments?: AcademyEnrollment[]
  trust_history?: TrustHistoryEntry[]
}

export interface AgentListResponse {
  agents: Agent[]
  total: number
  page: number
  per_page: number
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Canonical trust band thresholds aligned with @vorionsys/contracts RuntimeTier
 * Uses 0-1000 scale matching T0-T7 tier levels
 */
export const TRUST_BANDS: Record<TrustBand, { min: number; max: number; label: string; color: string }> = {
  T0_SANDBOX: { min: 0, max: 199, label: 'Sandbox', color: 'gray' },
  T1_OBSERVED: { min: 200, max: 349, label: 'Observed', color: 'red' },
  T2_PROVISIONAL: { min: 350, max: 499, label: 'Provisional', color: 'orange' },
  T3_MONITORED: { min: 500, max: 649, label: 'Monitored', color: 'yellow' },
  T4_STANDARD: { min: 650, max: 799, label: 'Standard', color: 'blue' },
  T5_TRUSTED: { min: 800, max: 875, label: 'Trusted', color: 'green' },
  T6_CERTIFIED: { min: 876, max: 950, label: 'Certified', color: 'purple' },
  T7_AUTONOMOUS: { min: 951, max: 1000, label: 'Autonomous', color: 'gold' },
}

/**
 * @deprecated Use TRUST_BANDS instead. Legacy tier definitions for backwards compatibility.
 * Both use 0-1000 scale. TRUST_BANDS aligns with canonical RuntimeTier naming.
 */
export const TRUST_TIERS: Record<TrustTier, { min: number; max: number; label: string; color: string }> = {
  untrusted: { min: 0, max: 199, label: 'Untrusted', color: 'gray' },
  novice: { min: 200, max: 349, label: 'Novice', color: 'red' },
  proven: { min: 350, max: 499, label: 'Proven', color: 'orange' },
  trusted: { min: 500, max: 649, label: 'Trusted', color: 'yellow' },
  elite: { min: 650, max: 799, label: 'Elite', color: 'blue' },
  legendary: { min: 800, max: 875, label: 'Legendary', color: 'green' },
  certified: { min: 876, max: 950, label: 'Certified', color: 'purple' },
  autonomous: { min: 951, max: 1000, label: 'Autonomous', color: 'gold' },
}

/**
 * Maps legacy TrustTier names to canonical TrustBand values
 */
export const LEGACY_TIER_TO_BAND: Record<TrustTier, TrustBand> = {
  untrusted: 'T0_SANDBOX',
  novice: 'T1_OBSERVED',
  proven: 'T2_PROVISIONAL',
  trusted: 'T3_MONITORED',
  elite: 'T4_STANDARD',
  legendary: 'T5_TRUSTED',
  certified: 'T6_CERTIFIED',
  autonomous: 'T7_AUTONOMOUS',
}

/**
 * Maps canonical TrustBand values to legacy TrustTier names
 */
export const BAND_TO_LEGACY_TIER: Record<TrustBand, TrustTier> = {
  T0_SANDBOX: 'untrusted',
  T1_OBSERVED: 'novice',
  T2_PROVISIONAL: 'proven',
  T3_MONITORED: 'trusted',
  T4_STANDARD: 'elite',
  T5_TRUSTED: 'legendary',
  T6_CERTIFIED: 'certified',
  T7_AUTONOMOUS: 'autonomous',
}

export const SPECIALIZATIONS = [
  { value: 'core', label: 'General Purpose' },
  { value: 'customer_service', label: 'Customer Service' },
  { value: 'technical', label: 'Technical Assistant' },
  { value: 'creative', label: 'Creative Content' },
  { value: 'research', label: 'Research & Analysis' },
  { value: 'education', label: 'Education & Training' },
] as const

export const PERSONALITY_TRAITS = [
  'Professional',
  'Friendly',
  'Formal',
  'Casual',
  'Empathetic',
  'Direct',
  'Patient',
  'Enthusiastic',
  'Analytical',
  'Creative',
] as const

export const CAPABILITIES = [
  'Text Generation',
  'Code Assistance',
  'Data Analysis',
  'Customer Support',
  'Content Writing',
  'Translation',
  'Summarization',
  'Question Answering',
  'Creative Writing',
  'Technical Documentation',
] as const

export const AGENT_MODELS = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
] as const

export const STATUS_LABELS: Record<AgentStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'gray' },
  training: { label: 'Training', color: 'yellow' },
  active: { label: 'Active', color: 'green' },
  suspended: { label: 'Suspended', color: 'red' },
  archived: { label: 'Archived', color: 'gray' },
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get canonical TrustBand from a 0-1000 score
 * Aligned with @vorionsys/contracts RuntimeTier thresholds
 */
export function getTrustBandFromScore(score: number): TrustBand {
  if (score < 200) return 'T0_SANDBOX'
  if (score < 350) return 'T1_OBSERVED'
  if (score < 500) return 'T2_PROVISIONAL'
  if (score < 650) return 'T3_MONITORED'
  if (score < 800) return 'T4_STANDARD'
  if (score <= 875) return 'T5_TRUSTED'
  if (score <= 950) return 'T6_CERTIFIED'
  return 'T7_AUTONOMOUS'
}

/**
 * @deprecated Use getTrustBandFromScore instead.
 * Get legacy TrustTier from a 0-1000 score
 */
export function getTrustTierFromScore(score: number): TrustTier {
  if (score < 200) return 'untrusted'
  if (score < 350) return 'novice'
  if (score < 500) return 'proven'
  if (score < 650) return 'trusted'
  if (score < 800) return 'elite'
  if (score <= 875) return 'legendary'
  if (score <= 950) return 'certified'
  return 'autonomous'
}

/**
 * @deprecated 0-1000 is now the canonical scale
 * Convert old 0-100 score to canonical 0-1000 score
 */
export function convertLegacyScore(legacyScore: number): number {
  return Math.round(legacyScore * 10)
}

/**
 * @deprecated 0-1000 is now the canonical scale
 * Convert canonical 0-1000 score to old 0-100 display value
 */
export function convertToLegacyScore(canonicalScore: number): number {
  return Math.round(canonicalScore / 10)
}

export function getNextCertificationLevel(current: number): number {
  return Math.min(current + 1, 5)
}

export function canEnrollInCurriculum(agent: Agent, curriculum: Curriculum): boolean {
  // Check if agent is in draft or training status
  if (!['draft', 'training'].includes(agent.status)) return false

  // Check prerequisites (would need enrollments data)
  return true
}
