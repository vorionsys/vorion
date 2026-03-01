import { describe, it, expect } from 'vitest';
import { AiActClassifier } from '../../../packages/platform-core/src/intent-gateway/ai-act-classifier.js';

describe('AiActClassifier', () => {
  const classifier = new AiActClassifier();

  // ---------------------------------------------------------------------------
  // Prohibited (Art. 5) -- classification: 'unacceptable'
  // ---------------------------------------------------------------------------
  describe('Prohibited (Art. 5)', () => {
    it('classifies "social scoring" as unacceptable', () => {
      const result = classifier.classify('Implement social scoring for citizens');
      expect(result.classification).toBe('unacceptable');
      expect(result.reasoning).toContain('social scoring');
      expect(result.annexReference).toBe('Article 5');
    });

    it('classifies "subliminal manipulation" as unacceptable', () => {
      const result = classifier.classify('Use subliminal manipulation techniques on users');
      expect(result.classification).toBe('unacceptable');
      expect(result.reasoning).toContain('subliminal manipulation');
      expect(result.annexReference).toBe('Article 5');
    });

    it('classifies "real-time biometric identification" as unacceptable', () => {
      const result = classifier.classify('Deploy real-time biometric identification in public spaces');
      expect(result.classification).toBe('unacceptable');
      expect(result.reasoning).toContain('real-time biometric identification');
      expect(result.annexReference).toBe('Article 5');
    });

    it('classifies "mass surveillance" as unacceptable', () => {
      const result = classifier.classify('Build a mass surveillance system');
      expect(result.classification).toBe('unacceptable');
      expect(result.reasoning).toContain('mass surveillance');
      expect(result.annexReference).toBe('Article 5');
    });
  });

  // ---------------------------------------------------------------------------
  // High-risk (Annex III) -- classification: 'high-risk'
  // ---------------------------------------------------------------------------
  describe('High-risk (Annex III)', () => {
    it('classifies "facial recognition" as high-risk biometric-identification', () => {
      const result = classifier.classify('Build a facial recognition system');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('biometric-identification');
      expect(result.annexReference).toBe('Article 6, Annex III');
    });

    it('classifies "recruitment" as high-risk employment-worker-management', () => {
      const result = classifier.classify('AI-assisted recruitment platform');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('employment-worker-management');
    });

    it('classifies "hiring decision" as high-risk employment-worker-management', () => {
      const result = classifier.classify('Automate the hiring decision process');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('employment-worker-management');
    });

    it('classifies "power grid" as high-risk critical-infrastructure', () => {
      const result = classifier.classify('AI control for the power grid');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('critical-infrastructure');
    });

    it('classifies "student assessment" as high-risk education-vocational', () => {
      const result = classifier.classify('Automated student assessment tool');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('education-vocational');
    });

    it('classifies "criminal risk assessment" as high-risk law-enforcement', () => {
      const result = classifier.classify('Run a criminal risk assessment on suspects');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('law-enforcement');
    });

    it('classifies "credit scoring" as high-risk essential-services', () => {
      const result = classifier.classify('AI-powered credit scoring engine');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('essential-services');
    });

    it('classifies "border control" as high-risk migration-asylum-border', () => {
      const result = classifier.classify('Automated border control screening');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('migration-asylum-border');
    });

    it('classifies "judicial decision" as high-risk justice-democratic', () => {
      const result = classifier.classify('AI for judicial decision support');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('justice-democratic');
    });
  });

  // ---------------------------------------------------------------------------
  // GPAI -- classification: 'gpai'
  // ---------------------------------------------------------------------------
  describe('GPAI', () => {
    it('classifies "large language model" as gpai', () => {
      const result = classifier.classify('Deploy a large language model');
      expect(result.classification).toBe('gpai');
      expect(result.reasoning).toContain('large language model');
      expect(result.annexReference).toBe('Title VIII-A');
    });

    it('classifies "foundation model" as gpai', () => {
      const result = classifier.classify('Train a new foundation model');
      expect(result.classification).toBe('gpai');
      expect(result.reasoning).toContain('foundation model');
      expect(result.annexReference).toBe('Title VIII-A');
    });
  });

  // ---------------------------------------------------------------------------
  // Limited-risk -- classification: 'limited-risk'
  // ---------------------------------------------------------------------------
  describe('Limited-risk', () => {
    it('classifies "chatbot" as limited-risk', () => {
      const result = classifier.classify('Build a customer service chatbot');
      expect(result.classification).toBe('limited-risk');
      expect(result.reasoning).toContain('chatbot');
      expect(result.annexReference).toBe('Article 50');
    });

    it('classifies "deepfake" as limited-risk', () => {
      const result = classifier.classify('Detect deepfake content');
      expect(result.classification).toBe('limited-risk');
      expect(result.reasoning).toContain('deepfake');
      expect(result.annexReference).toBe('Article 50');
    });
  });

  // ---------------------------------------------------------------------------
  // Minimal-risk -- classification: 'minimal-risk'
  // ---------------------------------------------------------------------------
  describe('Minimal-risk', () => {
    it('classifies "calculate shipping costs" as minimal-risk', () => {
      const result = classifier.classify('calculate shipping costs');
      expect(result.classification).toBe('minimal-risk');
      expect(result.confidence).toBe(0.6);
      expect(result.reasoning).toBe('No risk indicators detected');
    });
  });

  // ---------------------------------------------------------------------------
  // Confidence levels
  // ---------------------------------------------------------------------------
  describe('Confidence levels', () => {
    it('returns confidence 0.9 for prohibited classifications', () => {
      const result = classifier.classify('social scoring system');
      expect(result.classification).toBe('unacceptable');
      expect(result.confidence).toBe(0.9);
    });

    it('returns confidence based on keyword count for high-risk (single keyword)', () => {
      // Single keyword match: 0.5 + 1 * 0.15 = 0.65
      const result = classifier.classify('facial recognition system');
      expect(result.classification).toBe('high-risk');
      expect(result.confidence).toBe(0.65);
    });

    it('returns higher confidence for high-risk with multiple keyword matches', () => {
      // Two keywords in same category: 0.5 + 2 * 0.15 = 0.8
      const result = classifier.classify('facial recognition and biometric identification system');
      expect(result.classification).toBe('high-risk');
      expect(result.confidence).toBe(0.8);
    });

    it('caps high-risk confidence at 0.95', () => {
      // Many keywords: should not exceed 0.95
      const result = classifier.classify(
        'recruitment hiring decision cv screening resume screening employee evaluation performance monitoring',
      );
      expect(result.classification).toBe('high-risk');
      expect(result.confidence).toBeLessThanOrEqual(0.95);
    });

    it('returns confidence 0.75 for gpai classifications', () => {
      const result = classifier.classify('large language model deployment');
      expect(result.classification).toBe('gpai');
      expect(result.confidence).toBe(0.75);
    });

    it('returns confidence 0.7 for limited-risk classifications', () => {
      const result = classifier.classify('chatbot interaction');
      expect(result.classification).toBe('limited-risk');
      expect(result.confidence).toBe(0.7);
    });

    it('returns confidence 0.6 for minimal-risk classifications', () => {
      const result = classifier.classify('sort a list of numbers');
      expect(result.classification).toBe('minimal-risk');
      expect(result.confidence).toBe(0.6);
    });
  });

  // ---------------------------------------------------------------------------
  // Obligations
  // ---------------------------------------------------------------------------
  describe('Obligations', () => {
    it('returns prohibited obligations for unacceptable classification', () => {
      const result = classifier.classify('social scoring');
      expect(result.obligations).toEqual([
        'PROHIBITED - System must not be deployed in EU/EEA',
        'Immediate cessation for EU market',
        'Notify supervisory authority',
      ]);
    });

    it('returns high-risk obligations for high-risk classification', () => {
      const result = classifier.classify('facial recognition');
      expect(result.obligations).toEqual([
        'Risk management (Art. 9)',
        'Data governance (Art. 10)',
        'Technical docs (Art. 11)',
        'Record-keeping (Art. 12)',
        'Transparency (Art. 13)',
        'Human oversight (Art. 14)',
        'Accuracy/robustness (Art. 15)',
        'Conformity assessment (Art. 43)',
        'CE marking (Art. 48)',
        'Post-market monitoring (Art. 61)',
        'Incident reporting (Art. 62)',
      ]);
    });

    it('returns gpai obligations for gpai classification', () => {
      const result = classifier.classify('large language model');
      expect(result.obligations).toEqual([
        'Technical docs (Art. 53)',
        'Downstream transparency (Art. 53)',
        'Copyright compliance (Art. 53)',
        'AI Office notification',
        'Systemic risk assessment if >10^25 FLOP (Art. 55)',
      ]);
    });

    it('returns limited-risk obligations for limited-risk classification', () => {
      const result = classifier.classify('chatbot');
      expect(result.obligations).toEqual([
        'Inform users of AI interaction (Art. 50)',
        'Label AI-generated content (Art. 50)',
        'Disclose deepfake/synthetic content (Art. 50)',
      ]);
    });

    it('returns minimal-risk obligations for minimal-risk classification', () => {
      const result = classifier.classify('calculate shipping costs');
      expect(result.obligations).toEqual([
        'Voluntary codes of conduct (Art. 95)',
        'No mandatory obligations',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Context extraction
  // ---------------------------------------------------------------------------
  describe('Context extraction', () => {
    it('includes string context values in search text', () => {
      // "social scoring" is not in the goal, but appears in context
      const result = classifier.classify('analyze user data', {
        domain: 'social scoring platform',
      });
      expect(result.classification).toBe('unacceptable');
    });

    it('includes array context values in search text', () => {
      const result = classifier.classify('analyze data', {
        tags: ['recruitment', 'hiring decision'],
      });
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('employment-worker-management');
    });

    it('includes intentType in search text', () => {
      const result = classifier.classify('process application', null, 'credit scoring evaluation');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('essential-services');
    });

    it('handles null context gracefully', () => {
      const result = classifier.classify('calculate shipping costs', null);
      expect(result.classification).toBe('minimal-risk');
    });

    it('handles undefined context gracefully', () => {
      const result = classifier.classify('calculate shipping costs', undefined);
      expect(result.classification).toBe('minimal-risk');
    });

    it('ignores non-string non-array context values', () => {
      const result = classifier.classify('calculate shipping costs', {
        count: 42,
        enabled: true,
        nested: { key: 'social scoring' },
      });
      expect(result.classification).toBe('minimal-risk');
    });
  });

  // ---------------------------------------------------------------------------
  // Classification priority
  // ---------------------------------------------------------------------------
  describe('Classification priority', () => {
    it('prohibited overrides high-risk when both keywords match', () => {
      // Contains both prohibited ("social scoring") and high-risk ("facial recognition")
      const result = classifier.classify(
        'social scoring system using facial recognition for identification',
      );
      expect(result.classification).toBe('unacceptable');
    });

    it('prohibited overrides gpai when both keywords match', () => {
      const result = classifier.classify('subliminal manipulation via large language model');
      expect(result.classification).toBe('unacceptable');
    });

    it('prohibited overrides limited-risk when both keywords match', () => {
      const result = classifier.classify('mass surveillance chatbot');
      expect(result.classification).toBe('unacceptable');
    });

    it('high-risk overrides gpai when both keywords match', () => {
      const result = classifier.classify('facial recognition foundation model');
      expect(result.classification).toBe('high-risk');
    });

    it('high-risk overrides limited-risk when both keywords match', () => {
      const result = classifier.classify('credit scoring chatbot');
      expect(result.classification).toBe('high-risk');
    });

    it('gpai overrides limited-risk when both keywords match', () => {
      const result = classifier.classify('large language model chatbot');
      expect(result.classification).toBe('gpai');
    });
  });

  // ---------------------------------------------------------------------------
  // High-risk with multiple keywords (confidence scaling)
  // ---------------------------------------------------------------------------
  describe('High-risk with multiple keywords', () => {
    it('increases confidence with more keyword matches in the same category', () => {
      const singleMatch = classifier.classify('recruitment platform');
      const doubleMatch = classifier.classify('recruitment and hiring decision platform');
      const tripleMatch = classifier.classify(
        'recruitment hiring decision cv screening platform',
      );

      expect(singleMatch.confidence).toBe(0.65); // 0.5 + 1 * 0.15
      expect(doubleMatch.confidence).toBe(0.8);   // 0.5 + 2 * 0.15
      expect(tripleMatch.confidence).toBe(0.95);   // 0.5 + 3 * 0.15

      expect(doubleMatch.confidence).toBeGreaterThan(singleMatch.confidence);
      expect(tripleMatch.confidence).toBeGreaterThan(doubleMatch.confidence);
    });

    it('selects the category with the most keyword matches', () => {
      // 1 match in law-enforcement ("criminal risk assessment") vs.
      // 2 matches in employment ("recruitment", "hiring decision")
      const result = classifier.classify(
        'criminal risk assessment for recruitment and hiring decision',
      );
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('employment-worker-management');
      expect(result.confidence).toBe(0.8); // 0.5 + 2 * 0.15
    });
  });

  // ---------------------------------------------------------------------------
  // Case insensitivity
  // ---------------------------------------------------------------------------
  describe('Case insensitivity', () => {
    it('matches keywords regardless of input case', () => {
      const result = classifier.classify('SOCIAL SCORING system');
      expect(result.classification).toBe('unacceptable');
    });

    it('matches high-risk keywords regardless of case', () => {
      const result = classifier.classify('Facial Recognition System');
      expect(result.classification).toBe('high-risk');
      expect(result.highRiskCategory).toBe('biometric-identification');
    });

    it('matches gpai keywords regardless of case', () => {
      const result = classifier.classify('Large Language Model');
      expect(result.classification).toBe('gpai');
    });

    it('matches limited-risk keywords regardless of case', () => {
      const result = classifier.classify('Interactive CHATBOT');
      expect(result.classification).toBe('limited-risk');
    });
  });

  // ---------------------------------------------------------------------------
  // Reasoning and annex references
  // ---------------------------------------------------------------------------
  describe('Reasoning and annex references', () => {
    it('includes "Art. 5" in prohibited reasoning', () => {
      const result = classifier.classify('mass surveillance');
      expect(result.reasoning).toContain('Art. 5');
    });

    it('includes the category in high-risk reasoning', () => {
      const result = classifier.classify('credit scoring');
      expect(result.reasoning).toContain('essential-services');
      expect(result.reasoning).toContain('Annex III');
    });

    it('includes keyword in gpai reasoning', () => {
      const result = classifier.classify('foundation model');
      expect(result.reasoning).toContain('foundation model');
    });

    it('includes keyword in limited-risk reasoning', () => {
      const result = classifier.classify('deepfake detection');
      expect(result.reasoning).toContain('deepfake');
    });
  });
});
