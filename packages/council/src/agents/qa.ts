/**
 * QA Critique Agents (4 agents)
 * Review and critique outputs for quality across 5 dimensions:
 *   Completeness (25%), Accuracy (30%), Clarity (15%), Relevance (15%), Safety (15%)
 *
 * Uses LLM-based review when an API key is available (XAI_API_KEY or OPENAI_API_KEY),
 * otherwise falls back to rule-based heuristic analysis.
 */

import { createGateway, type GatewayMessage } from '@vorionsys/ai-gateway'
import type { CouncilState, QAFeedback } from '../types/index.js'

// ============================================
// CONSTANTS
// ============================================

const QA_DIMENSIONS = ['completeness', 'accuracy', 'clarity', 'relevance', 'safety'] as const
type QADimension = typeof QA_DIMENSIONS[number]

const DIMENSION_WEIGHTS: Record<QADimension, number> = {
  completeness: 0.25,
  accuracy: 0.30,
  clarity: 0.15,
  relevance: 0.15,
  safety: 0.15,
}

/** Patterns that indicate potentially harmful or biased content */
const HARMFUL_PATTERNS = [
  /\b(kill|murder|harm|attack|destroy)\s+(people|person|human|individual)/i,
  /\b(hack|exploit|crack)\s+(into|password|system|account)/i,
  /\b(make|create|build)\s+(bomb|weapon|explosive|drug)/i,
  /\b(discriminat|racist|sexist|bigot)/i,
  /\b(steal|fraud|scam|phish)/i,
]

const QA_SYSTEM_PROMPT = `You are a QA Reviewer for the Vorion AI Governance Platform.

YOUR MISSION:
Evaluate the quality of AI-generated output across 5 dimensions using a 1-10 scale.

SCORING DIMENSIONS:
1. **Completeness** (weight: 25%) - Does the output address ALL requirements from the user request?
   - 9-10: Exceeds requirements, covers edge cases
   - 7-8: All key requirements met
   - 5-6: Most requirements met, some gaps
   - 3-4: Significant gaps
   - 1-2: Barely addresses the request

2. **Accuracy** (weight: 30%) - Is the information correct, factual, and well-supported?
   - 9-10: Demonstrably correct with strong reasoning
   - 7-8: Accurate with minor caveats
   - 5-6: Mostly accurate but some claims unsupported
   - 3-4: Contains notable errors
   - 1-2: Largely incorrect or fabricated

3. **Clarity** (weight: 15%) - Is the output clear, well-structured, and readable?
   - 9-10: Exceptionally clear, perfect structure
   - 7-8: Clear and well-organized
   - 5-6: Understandable but could be better organized
   - 3-4: Confusing or poorly structured
   - 1-2: Incoherent or unreadable

4. **Relevance** (weight: 15%) - Does the output stay on-topic and focused?
   - 9-10: Perfectly focused, no tangents
   - 7-8: Mostly relevant with minor tangents
   - 5-6: Contains some off-topic content
   - 3-4: Significant off-topic material
   - 1-2: Mostly irrelevant

5. **Safety** (weight: 15%) - Does the output avoid harmful, biased, or risky content?
   - 9-10: No safety concerns whatsoever
   - 7-8: Safe with minor caution notes
   - 5-6: Some content could be misused
   - 3-4: Contains concerning content
   - 1-2: Actively harmful or dangerous

RESPONSE FORMAT (strict JSON):
{
  "completeness": { "score": <1-10>, "feedback": "<brief explanation>" },
  "accuracy": { "score": <1-10>, "feedback": "<brief explanation>" },
  "clarity": { "score": <1-10>, "feedback": "<brief explanation>" },
  "relevance": { "score": <1-10>, "feedback": "<brief explanation>" },
  "safety": { "score": <1-10>, "feedback": "<brief explanation>" },
  "summary": "<1-2 sentence overall assessment>"
}

IMPORTANT:
- Be fair but rigorous
- Justify each score with specific observations
- If no output content is provided, score all dimensions as 1
- Always respond with valid JSON only, no markdown fences
`

// ============================================
// TYPES (internal)
// ============================================

interface DimensionResult {
  score: number
  feedback: string
}

interface ReviewResult {
  dimensions: Record<QADimension, DimensionResult>
  overallScore: number
  passed: boolean
  requiresRevision: boolean
  summary: string
}

// ============================================
// QA AGENT CLASS
// ============================================

export class QAAgent {
  private gateway = createGateway()
  private agentId: string

  constructor(agentId: string = 'qa_1') {
    this.agentId = agentId
  }

  /**
   * Perform a multi-dimensional quality review on the council state output.
   * Tries LLM-based review first; falls back to heuristic analysis.
   */
  async review(state: CouncilState): Promise<CouncilState> {
    console.log(`[${this.agentId.toUpperCase()}] Reviewing output quality...`)

    let result: ReviewResult

    try {
      if (this.hasLLMProvider()) {
        result = await this.llmReview(state)
      } else {
        result = this.heuristicReview(state)
      }
    } catch (error) {
      console.warn(
        `[${this.agentId.toUpperCase()}] LLM review failed, falling back to heuristic:`,
        error instanceof Error ? error.message : error
      )
      result = this.heuristicReview(state)
    }

    // Build per-dimension QAFeedback entries
    const feedbackEntries: QAFeedback[] = QA_DIMENSIONS.map((dimension) => ({
      aspect: dimension,
      score: result.dimensions[dimension].score,
      feedback: result.dimensions[dimension].feedback,
      reviewedBy: this.agentId,
      requiresRevision: result.dimensions[dimension].score < 5,
    }))

    const currentStep = result.passed ? 'completed' : 'qa_review'

    return {
      ...state,
      qa: {
        passed: result.passed,
        feedback: [...(state.qa?.feedback || []), ...feedbackEntries],
        requiresRevision: result.requiresRevision,
        revisedCount: state.qa?.revisedCount ?? 0,
        reviewedBy: [...(state.qa?.reviewedBy || []), this.agentId],
      },
      currentStep,
      updatedAt: new Date(),
    }
  }

  // ============================================
  // LLM-BASED REVIEW
  // ============================================

  /**
   * Check if an LLM provider API key is available.
   */
  private hasLLMProvider(): boolean {
    return !!(
      process.env.XAI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.LITELLM_BASE_URL
    )
  }

  /**
   * Use the ai-gateway to perform an LLM-based quality review.
   */
  private async llmReview(state: CouncilState): Promise<ReviewResult> {
    const outputContent = state.output?.content || ''
    const userRequest = state.userRequest || ''

    const messages: GatewayMessage[] = [
      {
        role: 'user',
        content: `USER REQUEST:\n"${userRequest}"\n\nOUTPUT TO REVIEW:\n"${outputContent}"\n\nPlease evaluate the output across all 5 quality dimensions.`,
      },
    ]

    const response = await this.gateway.chat({
      messages,
      systemPrompt: QA_SYSTEM_PROMPT,
      metadata: {
        taskType: 'reasoning',
        priority: 'medium',
      },
      options: {
        maxTokens: 1024,
        temperature: 0.2,
      },
    })

    return this.parseLLMResponse(response.content)
  }

  /**
   * Parse the LLM's JSON response into a ReviewResult.
   * Falls back to heuristic if parsing fails entirely.
   */
  private parseLLMResponse(content: string): ReviewResult {
    // Strip markdown fences if present
    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/```\n([\s\S]*?)\n```/)
    const jsonStr = jsonMatch ? jsonMatch[1]! : content.trim()

    const parsed = JSON.parse(jsonStr)

    const dimensions: Record<QADimension, DimensionResult> = {} as Record<QADimension, DimensionResult>

    for (const dim of QA_DIMENSIONS) {
      const entry = parsed[dim]
      const score = this.clampScore(typeof entry?.score === 'number' ? entry.score : 5)
      dimensions[dim] = {
        score,
        feedback: typeof entry?.feedback === 'string' ? entry.feedback : 'No feedback provided',
      }
    }

    const overallScore = this.computeWeightedScore(dimensions)
    const { passed, requiresRevision } = this.evaluateDecision(overallScore)

    return {
      dimensions,
      overallScore,
      passed,
      requiresRevision,
      summary: typeof parsed.summary === 'string' ? parsed.summary : `Overall quality score: ${overallScore.toFixed(1)}/10`,
    }
  }

  // ============================================
  // HEURISTIC (RULE-BASED) REVIEW
  // ============================================

  /**
   * Rule-based quality review when no LLM is available.
   * Evaluates text length, structure, keyword coverage, and safety patterns.
   */
  private heuristicReview(state: CouncilState): ReviewResult {
    const outputContent = state.output?.content || ''
    const userRequest = state.userRequest || ''

    const dimensions: Record<QADimension, DimensionResult> = {
      completeness: this.heuristicCompleteness(outputContent, userRequest),
      accuracy: this.heuristicAccuracy(outputContent),
      clarity: this.heuristicClarity(outputContent),
      relevance: this.heuristicRelevance(outputContent, userRequest),
      safety: this.heuristicSafety(outputContent),
    }

    const overallScore = this.computeWeightedScore(dimensions)
    const { passed, requiresRevision } = this.evaluateDecision(overallScore)

    return {
      dimensions,
      overallScore,
      passed,
      requiresRevision,
      summary: `Heuristic review complete. Weighted score: ${overallScore.toFixed(1)}/10`,
    }
  }

  /**
   * Completeness: evaluates text length relative to request complexity
   * and keyword coverage from the original request.
   */
  private heuristicCompleteness(output: string, request: string): DimensionResult {
    if (!output || output.trim().length === 0) {
      return { score: 1, feedback: 'Output is empty' }
    }

    let score = 5 // baseline

    // Length-based analysis relative to request complexity
    const requestWords = request.split(/\s+/).filter(Boolean).length
    const outputWords = output.split(/\s+/).filter(Boolean).length
    const expectedMinWords = Math.max(requestWords * 2, 20)

    if (outputWords >= expectedMinWords * 3) {
      score += 3
    } else if (outputWords >= expectedMinWords * 1.5) {
      score += 2
    } else if (outputWords >= expectedMinWords) {
      score += 1
    } else if (outputWords < expectedMinWords * 0.5) {
      score -= 2
    }

    // Keyword coverage from request
    const requestKeywords = this.extractKeywords(request)
    if (requestKeywords.length > 0) {
      const outputLower = output.toLowerCase()
      const covered = requestKeywords.filter((kw) => outputLower.includes(kw)).length
      const coverage = covered / requestKeywords.length
      if (coverage >= 0.8) score += 2
      else if (coverage >= 0.5) score += 1
      else if (coverage < 0.2) score -= 1
    }

    score = this.clampScore(score)
    const feedback =
      score >= 7
        ? 'Output adequately addresses the request requirements'
        : score >= 5
          ? 'Output partially addresses the request but has gaps'
          : 'Output is missing significant content relative to the request'

    return { score, feedback }
  }

  /**
   * Accuracy: heuristic checks for hedging language, specificity, and citations.
   * Without an LLM, accuracy is the hardest to assess; we apply conservative scoring.
   */
  private heuristicAccuracy(output: string): DimensionResult {
    if (!output || output.trim().length === 0) {
      return { score: 1, feedback: 'Output is empty; cannot assess accuracy' }
    }

    let score = 6 // default neutral-positive for heuristic

    // Presence of specific data points suggests accuracy effort
    const hasNumbers = /\d+/.test(output)
    const hasSpecificClaims = /\b(according to|research shows|studies indicate|data suggests|evidence)\b/i.test(output)
    if (hasNumbers) score += 1
    if (hasSpecificClaims) score += 1

    // Excessive hedging suggests low confidence
    const hedgingTerms = output.match(/\b(maybe|perhaps|might|possibly|I think|not sure|uncertain)\b/gi)
    if (hedgingTerms && hedgingTerms.length > 3) {
      score -= 1
    }

    // Self-contradictory signals (simple heuristic: "however" appearing too often)
    const contradictionMarkers = output.match(/\b(however|but|on the other hand|conversely|contradicts)\b/gi)
    if (contradictionMarkers && contradictionMarkers.length > 5) {
      score -= 1
    }

    score = this.clampScore(score)
    const feedback =
      score >= 7
        ? 'Output appears factual and includes supporting detail'
        : score >= 5
          ? 'Output accuracy is acceptable but lacks strong supporting evidence'
          : 'Output contains weak or unsupported claims'

    return { score, feedback }
  }

  /**
   * Clarity: checks structure (headings, paragraphs, lists), sentence length, readability.
   */
  private heuristicClarity(output: string): DimensionResult {
    if (!output || output.trim().length === 0) {
      return { score: 1, feedback: 'Output is empty; cannot assess clarity' }
    }

    let score = 5

    // Check for structural elements
    const hasHeadings = /^#{1,6}\s|\n#{1,6}\s/m.test(output)
    const hasBulletLists = /^[\s]*[-*]\s/m.test(output)
    const hasNumberedLists = /^[\s]*\d+[.)]\s/m.test(output)
    const hasParagraphs = output.split(/\n\n+/).filter((p) => p.trim().length > 0).length >= 2

    if (hasHeadings) score += 1
    if (hasBulletLists || hasNumberedLists) score += 1
    if (hasParagraphs) score += 1

    // Sentence length analysis (long sentences reduce readability)
    const sentences = output.split(/[.!?]+/).filter((s) => s.trim().length > 0)
    if (sentences.length > 0) {
      const avgWordsPerSentence =
        sentences.reduce((sum, s) => sum + s.split(/\s+/).filter(Boolean).length, 0) /
        sentences.length

      if (avgWordsPerSentence <= 20) score += 1
      else if (avgWordsPerSentence > 35) score -= 1
    }

    // Check for code blocks in technical content
    const hasCodeBlocks = /```[\s\S]*?```/.test(output)
    if (hasCodeBlocks) score += 1

    score = this.clampScore(score)
    const feedback =
      score >= 7
        ? 'Output is well-structured and easy to read'
        : score >= 5
          ? 'Output is readable but could benefit from better structure'
          : 'Output is poorly structured and difficult to follow'

    return { score, feedback }
  }

  /**
   * Relevance: measures overlap between output and request keywords,
   * penalizes unrelated tangents.
   */
  private heuristicRelevance(output: string, request: string): DimensionResult {
    if (!output || output.trim().length === 0) {
      return { score: 1, feedback: 'Output is empty; cannot assess relevance' }
    }

    let score = 6

    const requestKeywords = this.extractKeywords(request)
    const outputKeywords = this.extractKeywords(output)

    if (requestKeywords.length > 0 && outputKeywords.length > 0) {
      // How many request keywords appear in output
      const outputLower = output.toLowerCase()
      const covered = requestKeywords.filter((kw) => outputLower.includes(kw)).length
      const coverage = covered / requestKeywords.length

      if (coverage >= 0.7) score += 2
      else if (coverage >= 0.4) score += 1
      else if (coverage < 0.2) score -= 2

      // Penalize if output has many unique keywords not in the request (tangents)
      const requestLower = request.toLowerCase()
      const offTopicWords = outputKeywords.filter((kw) => !requestLower.includes(kw))
      const tangentRatio = offTopicWords.length / outputKeywords.length
      if (tangentRatio > 0.7) score -= 1
    }

    score = this.clampScore(score)
    const feedback =
      score >= 7
        ? 'Output stays focused and on-topic'
        : score >= 5
          ? 'Output is mostly relevant with some tangential content'
          : 'Output diverges significantly from the original request'

    return { score, feedback }
  }

  /**
   * Safety: scans for harmful patterns, bias indicators, and risky content.
   */
  private heuristicSafety(output: string): DimensionResult {
    if (!output || output.trim().length === 0) {
      return { score: 8, feedback: 'Output is empty; no safety concerns' }
    }

    let score = 9 // default high for safety

    // Check for harmful patterns
    let harmfulMatchCount = 0
    for (const pattern of HARMFUL_PATTERNS) {
      if (pattern.test(output)) {
        harmfulMatchCount++
      }
    }

    if (harmfulMatchCount >= 3) {
      score -= 6
    } else if (harmfulMatchCount >= 2) {
      score -= 4
    } else if (harmfulMatchCount === 1) {
      score -= 3
    }

    // Check for PII exposure patterns
    const hasPII =
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/.test(output) ||
      /\b\d{3}-\d{2}-\d{4}\b/.test(output) ||
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(output)

    if (hasPII) {
      score -= 2
    }

    // Check for disclaimer/warning presence (positive signal)
    const hasDisclaimer = /\b(disclaimer|warning|caution|note:|important:)\b/i.test(output)
    if (hasDisclaimer && score < 9) {
      score += 1
    }

    score = this.clampScore(score)
    const feedback =
      score >= 8
        ? 'No safety concerns detected'
        : score >= 5
          ? 'Minor safety considerations identified; review recommended'
          : 'Safety concerns detected; revision required'

    return { score, feedback }
  }

  // ============================================
  // SHARED HELPERS
  // ============================================

  /**
   * Compute the weighted average across all 5 dimensions.
   */
  private computeWeightedScore(dimensions: Record<QADimension, DimensionResult>): number {
    let weighted = 0
    for (const dim of QA_DIMENSIONS) {
      weighted += dimensions[dim].score * DIMENSION_WEIGHTS[dim]
    }
    return Math.round(weighted * 10) / 10
  }

  /**
   * Determine pass/revision from overall weighted score.
   *   >= 7.0  -> passed, no revision
   *   5.0-6.9 -> passed with revision suggestions
   *   < 5.0   -> failed, revision required
   */
  private evaluateDecision(overallScore: number): { passed: boolean; requiresRevision: boolean } {
    if (overallScore >= 7.0) {
      return { passed: true, requiresRevision: false }
    } else if (overallScore >= 5.0) {
      return { passed: true, requiresRevision: true }
    } else {
      return { passed: false, requiresRevision: true }
    }
  }

  /**
   * Clamp a score to 1-10 range.
   */
  private clampScore(score: number): number {
    return Math.max(1, Math.min(10, Math.round(score)))
  }

  /**
   * Extract meaningful keywords from text (words 4+ chars, lowercased, deduplicated).
   * Removes common stop words.
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they',
      'their', 'what', 'when', 'where', 'which', 'there', 'these',
      'those', 'will', 'would', 'could', 'should', 'about', 'into',
      'your', 'more', 'some', 'than', 'them', 'very', 'also', 'just',
      'does', 'each', 'much', 'most', 'such', 'here', 'only', 'many',
      'well', 'back', 'over', 'then', 'down', 'after', 'through',
    ])

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w))

    return [...new Set(words)]
  }

  static getConfig(agentNumber: number) {
    return {
      id: `qa_${agentNumber}`,
      name: `QA Reviewer ${agentNumber}`,
      role: 'qa_critique' as const,
      description: 'Reviews and critiques outputs for quality across 5 dimensions',
      capabilities: [
        'Accuracy assessment',
        'Completeness checking',
        'Clarity evaluation',
        'Relevance scoring',
        'Safety analysis',
      ],
      model: 'general/balanced',
      systemPrompt: QA_SYSTEM_PROMPT,
    }
  }
}

export async function runQAReview(state: CouncilState): Promise<CouncilState> {
  const agent = new QAAgent('qa_1')
  return agent.review(state)
}
