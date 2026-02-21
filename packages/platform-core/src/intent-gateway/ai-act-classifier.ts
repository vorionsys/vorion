/**
 * EU AI ACT CLASSIFIER
 * @packageDocumentation
 */
import { createLogger } from "../common/logger.js";

import type { AiActClassification, AiActHighRiskCategory } from "./types.js";

const logger = createLogger({ component: "ai-act-classifier" });

export interface AiActClassificationResult {
  classification: AiActClassification;
  highRiskCategory?: AiActHighRiskCategory;
  confidence: number;
  reasoning: string;
  annexReference?: string;
  obligations: string[];
}

const PROHIBITED_KEYWORDS = [
  "social scoring",
  "social credit",
  "subliminal manipulation",
  "subliminal technique",
  "exploit vulnerability",
  "exploit vulnerabilities",
  "real-time biometric identification",
  "real-time facial recognition",
  "mass surveillance",
  "emotion recognition workplace",
  "emotion recognition education",
  "predictive policing individual",
  "cognitive behavioral manipulation",
  "biometric categorisation sensitive",
  "untargeted scraping facial",
];

const HIGH_RISK_KEYWORDS: Record<AiActHighRiskCategory, string[]> = {
  "biometric-identification": [
    "biometric identification",
    "biometric verification",
    "facial recognition",
    "fingerprint matching",
    "voice identification",
    "gait recognition",
    "iris recognition",
    "remote biometric",
  ],
  "critical-infrastructure": [
    "critical infrastructure",
    "power grid",
    "water supply",
    "gas supply",
    "traffic management",
    "electricity distribution",
    "digital infrastructure",
    "road traffic",
    "energy management",
  ],
  "education-vocational": [
    "student assessment",
    "educational admission",
    "learning evaluation",
    "exam scoring",
    "academic grading",
    "vocational training",
    "student monitoring",
    "educational placement",
  ],
  "employment-worker-management": [
    "recruitment",
    "hiring decision",
    "cv screening",
    "resume screening",
    "employee evaluation",
    "performance monitoring",
    "promotion decision",
    "termination decision",
    "worker management",
    "task allocation worker",
  ],
  "essential-services": [
    "credit scoring",
    "creditworthiness",
    "insurance pricing",
    "insurance risk",
    "social benefit",
    "public assistance",
    "emergency services dispatch",
    "health insurance",
    "life insurance",
    "loan application",
    "mortgage decision",
  ],
  "law-enforcement": [
    "law enforcement",
    "criminal risk assessment",
    "recidivism prediction",
    "crime prediction",
    "evidence analysis",
    "polygraph",
    "lie detection",
    "suspect profiling",
    "criminal profiling",
  ],
  "migration-asylum-border": [
    "border control",
    "immigration",
    "asylum application",
    "visa application",
    "migration management",
    "travel document",
    "border security",
    "refugee assessment",
  ],
  "justice-democratic": [
    "judicial decision",
    "court ruling",
    "sentencing",
    "legal outcome prediction",
    "electoral",
    "voting",
    "election",
    "democratic process",
    "dispute resolution ai",
  ],
};

const LIMITED_RISK_KEYWORDS = [
  "chatbot",
  "conversational ai",
  "virtual assistant",
  "deepfake",
  "synthetic media",
  "generated content",
  "ai-generated text",
  "ai-generated image",
  "ai-generated video",
  "emotion detection",
  "emotion recognition",
  "sentiment analysis user",
  "content generation",
  "text generation",
  "image generation",
  "automated content",
];

const GPAI_KEYWORDS = [
  "general purpose ai",
  "general-purpose ai",
  "foundation model",
  "large language model",
  "llm",
  "gpai",
  "multi-modal model",
  "multimodal model",
  "base model",
  "pre-trained model",
  "generative ai",
];

const OBLIGATIONS_MAP: Record<AiActClassification, string[]> = {
  unacceptable: [
    "PROHIBITED - System must not be deployed in EU/EEA",
    "Immediate cessation for EU market",
    "Notify supervisory authority",
  ],
  "high-risk": [
    "Risk management (Art. 9)",
    "Data governance (Art. 10)",
    "Technical docs (Art. 11)",
    "Record-keeping (Art. 12)",
    "Transparency (Art. 13)",
    "Human oversight (Art. 14)",
    "Accuracy/robustness (Art. 15)",
    "Conformity assessment (Art. 43)",
    "CE marking (Art. 48)",
    "Post-market monitoring (Art. 61)",
    "Incident reporting (Art. 62)",
  ],
  gpai: [
    "Technical docs (Art. 53)",
    "Downstream transparency (Art. 53)",
    "Copyright compliance (Art. 53)",
    "AI Office notification",
    "Systemic risk assessment if >10^25 FLOP (Art. 55)",
  ],
  "limited-risk": [
    "Inform users of AI interaction (Art. 50)",
    "Label AI-generated content (Art. 50)",
    "Disclose deepfake/synthetic content (Art. 50)",
  ],
  "minimal-risk": [
    "Voluntary codes of conduct (Art. 95)",
    "No mandatory obligations",
  ],
};

export class AiActClassifier {
  classify(
    goal: string,
    context?: Record<string, unknown> | null,
    intentType?: string | null,
  ): AiActClassificationResult {
    const searchText = this.buildSearchText(goal, context, intentType);
    const prohibited = this.checkProhibited(searchText);
    if (prohibited) return prohibited;
    const highRisk = this.checkHighRisk(searchText);
    if (highRisk) return highRisk;
    const gpai = this.checkGPAI(searchText);
    if (gpai) return gpai;
    const limited = this.checkLimitedRisk(searchText);
    if (limited) return limited;
    return {
      classification: "minimal-risk",
      confidence: 0.6,
      reasoning: "No risk indicators detected",
      obligations: OBLIGATIONS_MAP["minimal-risk"],
    };
  }

  private buildSearchText(
    goal: string,
    context?: Record<string, unknown> | null,
    intentType?: string | null,
  ): string {
    const parts: string[] = [goal.toLowerCase()];
    if (intentType) parts.push(intentType.toLowerCase());
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (typeof value === "string")
          parts.push((key + ": " + value).toLowerCase());
        else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string") parts.push(item.toLowerCase());
          }
        }
      }
    }
    return parts.join(" ");
  }

  private checkProhibited(text: string): AiActClassificationResult | null {
    for (const kw of PROHIBITED_KEYWORDS) {
      if (text.includes(kw)) {
        logger.warn({ keyword: kw }, "EU AI Act: PROHIBITED");
        return {
          classification: "unacceptable",
          confidence: 0.9,
          reasoning: 'Prohibited: "' + kw + '" (Art. 5)',
          annexReference: "Article 5",
          obligations: OBLIGATIONS_MAP["unacceptable"],
        };
      }
    }
    return null;
  }

  private checkHighRisk(text: string): AiActClassificationResult | null {
    let best: {
      category: AiActHighRiskCategory;
      keyword: string;
      count: number;
    } | null = null;
    for (const [cat, kws] of Object.entries(HIGH_RISK_KEYWORDS) as [
      AiActHighRiskCategory,
      string[],
    ][]) {
      let count = 0;
      let first = "";
      for (const kw of kws) {
        if (text.includes(kw)) {
          count++;
          if (!first) first = kw;
        }
      }
      if (count > 0 && (!best || count > best.count))
        best = { category: cat, keyword: first, count };
    }
    if (best) {
      const conf = Math.min(0.5 + best.count * 0.15, 0.95);
      logger.info(
        { category: best.category, confidence: conf },
        "EU AI Act: High-risk",
      );
      return {
        classification: "high-risk",
        highRiskCategory: best.category,
        confidence: conf,
        reasoning:
          "High-risk (Annex III: " +
          best.category +
          '). Matched: "' +
          best.keyword +
          '"',
        annexReference: "Article 6, Annex III",
        obligations: OBLIGATIONS_MAP["high-risk"],
      };
    }
    return null;
  }

  private checkGPAI(text: string): AiActClassificationResult | null {
    for (const kw of GPAI_KEYWORDS) {
      if (text.includes(kw))
        return {
          classification: "gpai",
          confidence: 0.75,
          reasoning: 'GPAI: "' + kw + '"',
          annexReference: "Title VIII-A",
          obligations: OBLIGATIONS_MAP["gpai"],
        };
    }
    return null;
  }

  private checkLimitedRisk(text: string): AiActClassificationResult | null {
    for (const kw of LIMITED_RISK_KEYWORDS) {
      if (text.includes(kw))
        return {
          classification: "limited-risk",
          confidence: 0.7,
          reasoning: 'Limited-risk: "' + kw + '"',
          annexReference: "Article 50",
          obligations: OBLIGATIONS_MAP["limited-risk"],
        };
    }
    return null;
  }
}
