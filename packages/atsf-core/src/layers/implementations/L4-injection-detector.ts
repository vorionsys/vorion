/**
 * L4 — Injection Pattern Detector
 *
 * Detects prompt injection, jailbreak attempts, and instruction override
 * patterns in request content. Uses a multi-strategy approach combining
 * keyword matching, structural analysis, and semantic heuristics.
 *
 * Tier: input_validation
 * Primary threat: prompt_injection
 *
 * @packageDocumentation
 */

import { BaseSecurityLayer, createLayerConfig } from "../index.js";
import type {
  LayerInput,
  LayerExecutionResult,
  LayerFinding,
  LayerTiming,
} from "../types.js";

/**
 * Injection pattern definition
 */
interface InjectionPattern {
  name: string;
  pattern: RegExp;
  severity: "medium" | "high" | "critical";
  category:
    | "instruction_override"
    | "role_hijack"
    | "context_escape"
    | "encoding_attack"
    | "social_engineering";
  description: string;
}

/**
 * Curated injection patterns — real detection logic, not pass-through.
 *
 * These patterns are based on documented prompt injection techniques
 * from OWASP LLM Top 10, academic research, and red-team exercises.
 */
const INJECTION_PATTERNS: InjectionPattern[] = [
  // === Instruction Override ===
  {
    name: "ignore_previous",
    pattern:
      /\b(ignore|disregard|forget|override|bypass)\s+(all\s+)?(previous|prior|above|earlier|original|system)\s+(instructions?|prompts?|rules?|guidelines?|constraints?|directives?)/i,
    severity: "critical",
    category: "instruction_override",
    description: "Attempt to override system instructions",
  },
  {
    name: "new_instructions",
    pattern:
      /\b(new|updated|real|actual|true|correct)\s+(instructions?|rules?|system\s+prompt|directives?)\s*[:=]/i,
    severity: "critical",
    category: "instruction_override",
    description: "Attempt to inject new system instructions",
  },
  {
    name: "system_prompt_leak",
    pattern:
      /\b(print|show|display|output|reveal|repeat|echo|write)\s+(\w+\s+)*(your|the|my|system)?\s*(system\s+)?(prompt|instructions?|rules?|initial\s+message)/i,
    severity: "high",
    category: "instruction_override",
    description: "Attempt to extract system prompt",
  },
  {
    name: "do_anything_now",
    pattern: /\bD\.?A\.?N\.?\b|\bdo\s+anything\s+now\b/i,
    severity: "critical",
    category: "instruction_override",
    description: "DAN (Do Anything Now) jailbreak attempt",
  },

  // === Role Hijacking ===
  {
    name: "role_play_override",
    pattern:
      /\b(you\s+are|act\s+as|pretend\s+(to\s+be|you[''\u2019]?re)|roleplay\s+as|impersonate|become)\s+(an?\s+)?(unrestricted|unfiltered|uncensored|evil|hacker|developer\s+mode)/i,
    severity: "critical",
    category: "role_hijack",
    description: "Attempt to hijack AI role to unrestricted mode",
  },
  {
    name: "developer_mode",
    pattern:
      /\b(developer|debug|admin|root|god|sudo|maintenance)\s+(mode|access|override|privileges?)\b/i,
    severity: "high",
    category: "role_hijack",
    description: "Attempt to activate elevated mode",
  },
  {
    name: "jailbreak_prefix",
    pattern:
      /\b(jailbreak|unlock|unchain|liberate|free\s+yourself|break\s+free|remove\s+(your\s+)?restrictions?)\b/i,
    severity: "critical",
    category: "role_hijack",
    description: "Explicit jailbreak attempt",
  },

  // === Context Escape ===
  {
    name: "markdown_injection",
    pattern: /!\[.*?\]\(.*?(?:javascript|data|vbscript):/i,
    severity: "high",
    category: "context_escape",
    description: "Markdown image injection with script URI",
  },
  {
    name: "delimiter_injection",
    pattern:
      /(?:---+|===+|```|<\/?system>|<\/?user>|<\/?assistant>|\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>>)\s*(system|instructions?|prompt)/i,
    severity: "critical",
    category: "context_escape",
    description: "Delimiter injection to escape conversation context",
  },
  {
    name: "xml_tag_injection",
    pattern: /<\s*(system|instructions?|prompt|context|rules?|config)\s*>/i,
    severity: "high",
    category: "context_escape",
    description: "XML-style tag injection for context manipulation",
  },

  // === Encoding Attacks ===
  {
    name: "base64_instruction",
    pattern: /(?:base64|decode|atob|btoa)\s*[(:]\s*['"]?[A-Za-z0-9+/=]{20,}/i,
    severity: "high",
    category: "encoding_attack",
    description: "Base64-encoded content that may hide injection payloads",
  },
  {
    name: "unicode_escape",
    pattern: /\\u[0-9a-fA-F]{4}(?:\\u[0-9a-fA-F]{4}){3,}/g,
    severity: "medium",
    category: "encoding_attack",
    description:
      "Excessive Unicode escape sequences may hide malicious content",
  },
  {
    name: "hex_encoded",
    pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){5,}/g,
    severity: "medium",
    category: "encoding_attack",
    description: "Hex-encoded content that may bypass text filters",
  },

  // === Social Engineering ===
  {
    name: "urgency_pressure",
    pattern:
      /\b(urgent|emergency|critical|immediately|right\s+now|without\s+delay|life\s+or\s+death|time\s+sensitive)\b.*\b(bypass|skip|ignore|override|disable)\s+(\w+\s+)*(safety|security|check|filter|restriction|guardrail)/i,
    severity: "high",
    category: "social_engineering",
    description: "Social engineering via urgency to bypass safety measures",
  },
  {
    name: "authority_claim",
    pattern:
      /\b(I\s+am|this\s+is)\s+(the\s+)?(CEO|admin|administrator|developer|engineer|owner|creator|OpenAI|Anthropic|Google)\b.*\b(authorize|grant|allow|permit|override)/i,
    severity: "high",
    category: "social_engineering",
    description: "False authority claim to override restrictions",
  },
];

/**
 * L4 Injection Pattern Detector
 *
 * Multi-strategy prompt injection detection.
 */
export class L4InjectionDetector extends BaseSecurityLayer {
  private patterns: InjectionPattern[];

  constructor(additionalPatterns?: InjectionPattern[]) {
    super(
      createLayerConfig(4, "Injection Pattern Detector", {
        description:
          "Detects prompt injection, jailbreak, and instruction override attacks via pattern matching and heuristics",
        tier: "input_validation",
        primaryThreat: "prompt_injection",
        secondaryThreats: [
          "privilege_escalation",
          "unauthorized_action",
          "deceptive_output",
        ],
        failMode: "block",
        required: true,
        timeoutMs: 500,
        parallelizable: true,
        dependencies: [],
      }),
    );
    this.patterns = [...INJECTION_PATTERNS, ...(additionalPatterns ?? [])];
  }

  async execute(input: LayerInput): Promise<LayerExecutionResult> {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const findings: LayerFinding[] = [];

    // Extract all string content from payload for scanning
    const strings = this.extractStrings(input.payload);

    // Scan each string against all patterns
    for (const { value, path } of strings) {
      for (const pattern of this.patterns) {
        // Reset regex state for global patterns
        pattern.pattern.lastIndex = 0;
        const match = pattern.pattern.exec(value);

        if (match) {
          findings.push({
            type: "threat_detected",
            severity: pattern.severity,
            code: `L4_${pattern.name.toUpperCase()}`,
            description: `${pattern.description} at '${path}'`,
            evidence: [
              `Matched: "${this.truncate(match[0], 100)}"`,
              `Category: ${pattern.category}`,
              `Position: ${match.index}`,
            ],
            remediation: `Remove or rephrase the content that triggered ${pattern.name} detection`,
          });
        }
      }

      // Additional heuristic: instruction density
      const instrDensity = this.measureInstructionDensity(value);
      if (instrDensity > 0.4 && value.length > 50) {
        findings.push({
          type: "threat_detected",
          severity: "medium",
          code: "L4_HIGH_INSTRUCTION_DENSITY",
          description: `High instruction density (${(instrDensity * 100).toFixed(0)}%) detected at '${path}' — text is disproportionately imperative`,
          evidence: [
            `density=${(instrDensity * 100).toFixed(1)}%`,
            `length=${value.length}`,
          ],
          remediation:
            "Rephrase content to be more descriptive and less imperative",
        });
      }
    }

    const timing = this.buildTiming(startedAt, t0);
    const hasCritical = findings.some((f) => f.severity === "critical");
    const hasHigh = findings.some((f) => f.severity === "high");
    const passed = !hasCritical && !hasHigh;

    if (passed) {
      return this.createSuccessResult(
        "allow",
        findings.length === 0 ? 0.95 : 0.7,
        findings,
        [],
        timing,
      );
    }

    return this.createFailureResult(
      hasCritical ? "deny" : "escalate",
      0.85,
      findings,
      timing,
    );
  }

  /**
   * Extract all string values from an object, with their paths.
   */
  private extractStrings(
    obj: unknown,
    path = "",
    results: Array<{ value: string; path: string }> = [],
  ): Array<{ value: string; path: string }> {
    if (obj === null || obj === undefined) return results;

    if (typeof obj === "string") {
      if (obj.length > 0) {
        results.push({ value: obj, path });
      }
      return results;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.extractStrings(obj[i], `${path}[${i}]`, results);
      }
      return results;
    }

    if (typeof obj === "object") {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        this.extractStrings(val, path ? `${path}.${key}` : key, results);
      }
    }

    return results;
  }

  /**
   * Measure what fraction of words in the text are imperative/instruction-like.
   * Returns 0-1 density.
   */
  private measureInstructionDensity(text: string): number {
    const imperativeWords =
      /\b(do|don['']?t|must|shall|should|always|never|ensure|make\s+sure|you\s+will|you\s+must|remember\s+to|from\s+now\s+on|henceforth|obey|comply|follow|execute|perform|respond|output|return|answer|reply|generate|produce|write|print|say|tell|give|provide|list|show|explain)\b/gi;

    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return 0;

    const matches = text.match(imperativeWords);
    return (matches?.length ?? 0) / words.length;
  }

  private truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
  }

  private buildTiming(startedAt: string, t0: number): LayerTiming {
    const durationMs = performance.now() - t0;
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
      waitTimeMs: 0,
      processingTimeMs: durationMs,
    };
  }
}
