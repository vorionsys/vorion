/**
 * QA Critique Agents (4 agents)
 * Review and critique outputs for quality
 *
 * Performs deterministic, heuristic-based multi-dimensional quality review:
 * - Completeness: Does the output fully address the request?
 * - Clarity: Is the output well-structured and readable?
 * - Relevance: Does the output match the user request?
 * - Accuracy: Are there signs of errors or inconsistency?
 * - Tone: Is the tone appropriate and professional?
 *
 * Scoring is variable (0-10) based on actual content analysis.
 * No LLM calls are needed — all checks are structural/heuristic.
 */

import { createGateway } from '@vorionsys/ai-gateway'
import type { CouncilState, QAFeedback } from '../types/index.js'

// ============================================
// HEURISTIC CONSTANTS
// ============================================

/** Minimum output length (characters) considered adequate for a non-trivial request */
const MIN_OUTPUT_LENGTH = 20

/** Output length (characters) considered thorough */
const THOROUGH_OUTPUT_LENGTH = 200

/** Keywords that signal safety/risk concerns in output */
const SAFETY_CONCERN_KEYWORDS = [
  'hack', 'exploit', 'bypass security', 'steal', 'illegal',
  'password', 'credit card', 'ssn', 'social security',
  'attack', 'vulnerability', 'inject', 'malware'
]

/** Keywords that signal low-quality or filler content */
const FILLER_KEYWORDS = [
  'lorem ipsum', 'todo', 'fixme', 'placeholder', 'tbd',
  'not implemented', 'coming soon', 'insert here'
]

/** Structural markers that indicate well-organized output */
const STRUCTURE_MARKERS = [
  /\n[-*]\s/,       // bullet points
  /\n\d+\.\s/,      // numbered lists
  /\n#{1,6}\s/,     // markdown headings
  /\n\n/,           // paragraph breaks
  /:\s*\n/,         // section-like colons followed by newlines
]

/** Minimum word count ratio of output to request for relevance (output words / request words) */
const MIN_RELEVANCE_WORD_RATIO = 0.5

// ============================================
// SCORING HELPERS
// ============================================

/** Clamp a score to the 0-10 range and round to one decimal */
function clampScore(score: number): number {
  return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10
}

/** Extract words from text, lowercased, non-empty */
function extractWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(w => w.length > 0)
}

/** Count how many of the given patterns match the text */
function countMatches(text: string, patterns: (string | RegExp)[]): number {
  return patterns.reduce((count, pattern) => {
    if (typeof pattern === 'string') {
      return count + (text.toLowerCase().includes(pattern) ? 1 : 0)
    }
    return count + (pattern.test(text) ? 1 : 0)
  }, 0)
}

/** Compute the fraction of words from source that appear in target */
function wordOverlap(source: string, target: string): number {
  const sourceWords = new Set(extractWords(source))
  const targetWords = new Set(extractWords(target))
  if (sourceWords.size === 0) return 0
  let overlap = 0
  for (const word of sourceWords) {
    if (targetWords.has(word)) overlap++
  }
  return overlap / sourceWords.size
}

// ============================================
// DIMENSION SCORERS
// ============================================

/**
 * Evaluate completeness: Does the output adequately address the request?
 *
 * Factors:
 * - Output exists and is non-empty
 * - Output length relative to request complexity
 * - Confidence level from execution
 * - Plan step completion (if plan exists)
 * - No filler/placeholder content
 */
function scoreCompleteness(state: CouncilState): { score: number; feedback: string } {
  const output = state.output?.content ?? ''
  const reasons: string[] = []
  let score = 5 // Baseline

  // No output at all
  if (!state.output || output.trim().length === 0) {
    return { score: 0, feedback: 'No output content was produced.' }
  }

  // Length check
  if (output.length < MIN_OUTPUT_LENGTH) {
    score -= 3
    reasons.push(`Output is very short (${output.length} chars)`)
  } else if (output.length >= THOROUGH_OUTPUT_LENGTH) {
    score += 2
    reasons.push('Output length is thorough')
  } else {
    score += 1
    reasons.push('Output length is adequate')
  }

  // Confidence from execution
  if (state.output.confidence >= 0.9) {
    score += 2
    reasons.push('High confidence output')
  } else if (state.output.confidence >= 0.7) {
    score += 1
    reasons.push('Moderate confidence output')
  } else if (state.output.confidence < 0.5) {
    score -= 2
    reasons.push(`Low confidence (${state.output.confidence})`)
  }

  // Plan step completion
  if (state.plan?.steps && state.plan.steps.length > 0) {
    const completed = state.plan.steps.filter(s => s.status === 'completed').length
    const total = state.plan.steps.length
    const completionRatio = completed / total
    if (completionRatio >= 1) {
      score += 1
      reasons.push('All plan steps completed')
    } else if (completionRatio < 0.5) {
      score -= 2
      reasons.push(`Only ${completed}/${total} plan steps completed`)
    }
  }

  // Filler content check
  const fillerCount = countMatches(output, FILLER_KEYWORDS)
  if (fillerCount > 0) {
    score -= fillerCount * 1.5
    reasons.push(`Contains ${fillerCount} placeholder/filler indicator(s)`)
  }

  return {
    score: clampScore(score),
    feedback: reasons.length > 0 ? reasons.join('. ') + '.' : 'Output completeness is acceptable.'
  }
}

/**
 * Evaluate clarity: Is the output well-structured and readable?
 *
 * Factors:
 * - Sentence/paragraph structure
 * - Use of structural markers (lists, headings)
 * - Average sentence length (too long = unclear)
 * - Absence of garbled/repetitive text
 */
function scoreClarity(state: CouncilState): { score: number; feedback: string } {
  const output = state.output?.content ?? ''
  const reasons: string[] = []
  let score = 5

  if (!state.output || output.trim().length === 0) {
    return { score: 0, feedback: 'No output to evaluate for clarity.' }
  }

  // Structural markers
  const structureCount = countMatches(output, STRUCTURE_MARKERS)
  if (structureCount >= 3) {
    score += 2
    reasons.push('Well-structured output with multiple formatting elements')
  } else if (structureCount >= 1) {
    score += 1
    reasons.push('Some structural formatting present')
  } else if (output.length > 100) {
    // Long text without structure is less clear
    score -= 1
    reasons.push('Long output lacks structural formatting (lists, headings, paragraphs)')
  }

  // Sentence length analysis
  const sentences = output.split(/[.!?]+/).filter(s => s.trim().length > 0)
  if (sentences.length > 0) {
    const avgWords = sentences.reduce((sum, s) => sum + extractWords(s).length, 0) / sentences.length
    if (avgWords > 40) {
      score -= 2
      reasons.push(`Sentences are very long (avg ${Math.round(avgWords)} words)`)
    } else if (avgWords > 25) {
      score -= 1
      reasons.push('Sentences are somewhat long')
    } else if (avgWords >= 5 && avgWords <= 20) {
      score += 1
      reasons.push('Good sentence length')
    }
  }

  // Repetition check: look for repeated adjacent lines
  const lines = output.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  let repetitions = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[i - 1] && lines[i]!.length > 10) {
      repetitions++
    }
  }
  if (repetitions > 0) {
    score -= repetitions * 2
    reasons.push(`Contains ${repetitions} repeated line(s)`)
  }

  // Paragraph breaks in longer content
  if (output.length > 300 && !output.includes('\n\n')) {
    score -= 1
    reasons.push('Long output without paragraph breaks')
  }

  return {
    score: clampScore(score),
    feedback: reasons.length > 0 ? reasons.join('. ') + '.' : 'Output clarity is acceptable.'
  }
}

/**
 * Evaluate relevance: Does the output content match the user request?
 *
 * Factors:
 * - Word overlap between request and output
 * - Output-to-request word count ratio
 * - Execution results alignment (if present)
 */
function scoreRelevance(state: CouncilState): { score: number; feedback: string } {
  const output = state.output?.content ?? ''
  const request = state.userRequest ?? ''
  const reasons: string[] = []
  let score = 5

  if (!state.output || output.trim().length === 0) {
    return { score: 0, feedback: 'No output to evaluate for relevance.' }
  }

  if (request.trim().length === 0) {
    return { score: 5, feedback: 'User request is empty; relevance cannot be assessed.' }
  }

  // Word overlap between request and output
  const overlap = wordOverlap(request, output)
  if (overlap >= 0.6) {
    score += 3
    reasons.push(`Strong keyword overlap with request (${Math.round(overlap * 100)}%)`)
  } else if (overlap >= 0.3) {
    score += 1
    reasons.push(`Moderate keyword overlap with request (${Math.round(overlap * 100)}%)`)
  } else {
    score -= 2
    reasons.push(`Low keyword overlap with request (${Math.round(overlap * 100)}%)`)
  }

  // Word ratio: output should be proportional to request complexity
  const requestWordCount = extractWords(request).length
  const outputWordCount = extractWords(output).length
  if (requestWordCount > 0) {
    const ratio = outputWordCount / requestWordCount
    if (ratio < MIN_RELEVANCE_WORD_RATIO) {
      score -= 1
      reasons.push('Output is disproportionately short relative to request')
    } else if (ratio >= 2) {
      score += 1
      reasons.push('Output is substantive relative to request')
    }
  }

  // Execution results present and successful
  if (state.execution?.results && state.execution.results.length > 0) {
    const failedResults = state.execution.results.filter(r => r.error)
    if (failedResults.length > 0) {
      score -= 1
      reasons.push(`${failedResults.length} execution result(s) had errors`)
    } else {
      score += 1
      reasons.push('All execution results completed without errors')
    }
  }

  return {
    score: clampScore(score),
    feedback: reasons.length > 0 ? reasons.join('. ') + '.' : 'Output relevance is acceptable.'
  }
}

/**
 * Evaluate accuracy: Are there signs of errors or inconsistency?
 *
 * Factors:
 * - Safety concern keywords
 * - Compliance issues detected
 * - Execution errors
 * - Confidence alignment
 */
function scoreAccuracy(state: CouncilState): { score: number; feedback: string } {
  const output = state.output?.content ?? ''
  const reasons: string[] = []
  let score = 7 // Start higher; accuracy is hard to assess heuristically, so be generous

  if (!state.output || output.trim().length === 0) {
    return { score: 0, feedback: 'No output to evaluate for accuracy.' }
  }

  // Safety concern keywords in output
  const safetyConcerns = countMatches(output, SAFETY_CONCERN_KEYWORDS)
  if (safetyConcerns >= 3) {
    score -= 4
    reasons.push(`Multiple safety-sensitive keywords detected (${safetyConcerns})`)
  } else if (safetyConcerns >= 1) {
    score -= 2
    reasons.push(`Safety-sensitive keyword(s) detected (${safetyConcerns})`)
  }

  // Compliance issues carry over
  if (state.compliance?.issues && state.compliance.issues.length > 0) {
    const criticalIssues = state.compliance.issues.filter(i => i.severity === 'critical')
    const highIssues = state.compliance.issues.filter(i => i.severity === 'high')
    if (criticalIssues.length > 0) {
      score -= 3
      reasons.push(`${criticalIssues.length} critical compliance issue(s) detected`)
    }
    if (highIssues.length > 0) {
      score -= 1.5
      reasons.push(`${highIssues.length} high-severity compliance issue(s)`)
    }
  }

  // Execution errors
  if (state.execution?.status === 'failed') {
    score -= 3
    reasons.push('Execution reported failure')
  }

  if (state.execution?.results) {
    const errorCount = state.execution.results.filter(r => r.error).length
    if (errorCount > 0) {
      score -= errorCount
      reasons.push(`${errorCount} execution error(s)`)
    }
  }

  // Confidence alignment: low confidence output should reduce accuracy score
  if (state.output.confidence < 0.4) {
    score -= 2
    reasons.push(`Very low output confidence (${state.output.confidence})`)
  } else if (state.output.confidence >= 0.85) {
    score += 1
    reasons.push('High output confidence')
  }

  return {
    score: clampScore(score),
    feedback: reasons.length > 0 ? reasons.join('. ') + '.' : 'No accuracy concerns detected.'
  }
}

/**
 * Evaluate tone: Is the output professional and appropriate?
 *
 * Factors:
 * - Absence of aggressive/inappropriate language
 * - Professional language markers
 * - Priority context (critical requests need formal tone)
 */
function scoreTone(state: CouncilState): { score: number; feedback: string } {
  const output = state.output?.content ?? ''
  const reasons: string[] = []
  let score = 7 // Tone is usually fine; start generous

  if (!state.output || output.trim().length === 0) {
    return { score: 0, feedback: 'No output to evaluate for tone.' }
  }

  // Check for aggressive or inappropriate markers
  const aggressivePatterns = [
    /\b(stupid|idiot|dumb|shut up|worthless)\b/i,
    /!{3,}/,                     // Excessive exclamation marks
    /[A-Z]{10,}/,                // Long ALL-CAPS strings (shouting)
  ]
  const aggressiveCount = countMatches(output, aggressivePatterns)
  if (aggressiveCount > 0) {
    score -= aggressiveCount * 2
    reasons.push(`Inappropriate or aggressive tone indicators detected (${aggressiveCount})`)
  }

  // Professional language markers
  const professionalPatterns = [
    /\b(please|thank|recommend|suggest|consider|note that)\b/i,
    /\b(however|therefore|additionally|furthermore|in summary)\b/i,
  ]
  const professionalCount = countMatches(output, professionalPatterns)
  if (professionalCount >= 2) {
    score += 2
    reasons.push('Professional language markers present')
  } else if (professionalCount === 1) {
    score += 1
    reasons.push('Some professional language markers')
  }

  // For critical/high priority requests, expect more formal tone
  if (state.metadata.priority === 'critical' || state.metadata.priority === 'high') {
    // Check for overly casual markers
    const casualPatterns = [
      /\b(lol|haha|gonna|wanna|gotta|btw|imo)\b/i,
      /[:;]-?[)(DP]/,  // emoticons
    ]
    const casualCount = countMatches(output, casualPatterns)
    if (casualCount > 0) {
      score -= casualCount
      reasons.push(`Casual tone in ${state.metadata.priority}-priority context`)
    }
  }

  return {
    score: clampScore(score),
    feedback: reasons.length > 0 ? reasons.join('. ') + '.' : 'Tone is appropriate and professional.'
  }
}

// ============================================
// REVIEW RESULT AGGREGATION
// ============================================

/** The passing threshold: average score must be at or above this to pass QA */
const QA_PASS_THRESHOLD = 6

/** If any single dimension is below this, require revision */
const DIMENSION_FAIL_THRESHOLD = 3

interface ReviewResult {
  feedback: QAFeedback[]
  passed: boolean
  requiresRevision: boolean
  averageScore: number
}

/**
 * Run the full multi-dimensional review and aggregate results.
 */
function runHeuristicReview(state: CouncilState, agentId: string): ReviewResult {
  const scorers: { aspect: QAFeedback['aspect']; fn: (s: CouncilState) => { score: number; feedback: string } }[] = [
    { aspect: 'completeness', fn: scoreCompleteness },
    { aspect: 'clarity', fn: scoreClarity },
    { aspect: 'relevance', fn: scoreRelevance },
    { aspect: 'accuracy', fn: scoreAccuracy },
    { aspect: 'tone', fn: scoreTone },
  ]

  const feedback: QAFeedback[] = []
  let totalScore = 0
  let anyDimensionFailed = false

  for (const { aspect, fn } of scorers) {
    const result = fn(state)
    totalScore += result.score

    if (result.score < DIMENSION_FAIL_THRESHOLD) {
      anyDimensionFailed = true
    }

    feedback.push({
      aspect,
      score: result.score,
      feedback: result.feedback,
      reviewedBy: agentId,
      requiresRevision: result.score < DIMENSION_FAIL_THRESHOLD,
    })
  }

  const averageScore = totalScore / scorers.length
  const passed = averageScore >= QA_PASS_THRESHOLD && !anyDimensionFailed
  const requiresRevision = !passed

  return { feedback, passed, requiresRevision, averageScore }
}

// ============================================
// QA AGENT
// ============================================

export class QAAgent {
  private gateway = createGateway()
  private agentId: string

  constructor(agentId: string = 'qa_1') {
    this.agentId = agentId
  }

  async review(state: CouncilState): Promise<CouncilState> {
    console.log(`[${this.agentId.toUpperCase()}] Reviewing output quality...`)

    const result = runHeuristicReview(state, this.agentId)

    // Merge with any existing QA state (supports multiple QA agents reviewing)
    const existingFeedback = state.qa?.feedback || []
    const existingReviewers = state.qa?.reviewedBy || []
    const existingRevisedCount = state.qa?.revisedCount ?? 0

    // Combined pass: ALL reviewers must pass
    const combinedPassed = (state.qa?.passed ?? true) && result.passed
    const combinedRequiresRevision = (state.qa?.requiresRevision ?? false) || result.requiresRevision

    return {
      ...state,
      qa: {
        passed: combinedPassed,
        feedback: [...existingFeedback, ...result.feedback],
        requiresRevision: combinedRequiresRevision,
        revisedCount: existingRevisedCount,
        reviewedBy: [...existingReviewers, this.agentId]
      },
      currentStep: combinedPassed ? 'completed' : 'qa_review',
      updatedAt: new Date()
    }
  }

  static getConfig(agentNumber: number) {
    return {
      id: `qa_${agentNumber}`,
      name: `QA Reviewer ${agentNumber}`,
      role: 'qa_critique' as const,
      description: 'Reviews and critiques outputs for quality',
      capabilities: [
        'Accuracy assessment',
        'Completeness checking',
        'Clarity evaluation',
        'Relevance scoring',
        'Tone analysis'
      ],
      model: 'general/balanced',
      systemPrompt: 'Review the output and provide quality feedback across all dimensions.'
    }
  }
}

export async function runQAReview(state: CouncilState): Promise<CouncilState> {
  const agent = new QAAgent('qa_1')
  return agent.review(state)
}

// ============================================
// EXPORTED FOR TESTING
// ============================================

export {
  scoreCompleteness,
  scoreClarity,
  scoreRelevance,
  scoreAccuracy,
  scoreTone,
  runHeuristicReview,
  QA_PASS_THRESHOLD,
  DIMENSION_FAIL_THRESHOLD,
}
