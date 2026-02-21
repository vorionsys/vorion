/**
 * Snapshot tests for common primitive schemas.
 *
 * These tests detect breaking changes to foundational types used across
 * all contract versions. Any schema structure change will fail the snapshot
 * and require explicit approval.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { describeSchema } from './helpers/schema-descriptor';

import {
  UUIDSchema,
  SemVerSchema,
  TimestampSchema,
  HashSchema,
  CorrelationIdSchema,
  ActorTypeSchema,
  ActorSchema,
  TrustBandSchema,
  AutonomyLevelSchema,
  DecisionOutcomeSchema,
  ExecutionOutcomeSchema,
  SeveritySchema,
  RiskLevelSchema,
} from '../src/common/primitives';

describe('Common Primitives', () => {
  describe('Identifier Schemas', () => {
    it('UUIDSchema shape', () => {
      expect(describeSchema(UUIDSchema)).toMatchSnapshot();
    });

    it('UUIDSchema accepts valid UUID', () => {
      const result = UUIDSchema.safeParse('550e8400-e29b-41d4-a716-446655440000');
      expect(result.success).toBe(true);
    });

    it('UUIDSchema rejects invalid string', () => {
      const result = UUIDSchema.safeParse('not-a-uuid');
      expect(result.success).toBe(false);
    });

    it('SemVerSchema shape', () => {
      expect(describeSchema(SemVerSchema)).toMatchSnapshot();
    });

    it('SemVerSchema accepts valid semver', () => {
      expect(SemVerSchema.safeParse('1.2.3').success).toBe(true);
      expect(SemVerSchema.safeParse('0.0.1-beta.1').success).toBe(true);
    });

    it('SemVerSchema rejects invalid semver', () => {
      expect(SemVerSchema.safeParse('1.2').success).toBe(false);
      expect(SemVerSchema.safeParse('v1.0.0').success).toBe(false);
    });

    it('TimestampSchema shape', () => {
      expect(describeSchema(TimestampSchema)).toMatchSnapshot();
    });

    it('TimestampSchema accepts ISO datetime', () => {
      expect(TimestampSchema.safeParse('2024-01-15T10:30:00Z').success).toBe(true);
    });

    it('TimestampSchema rejects invalid datetime', () => {
      expect(TimestampSchema.safeParse('yesterday').success).toBe(false);
    });

    it('HashSchema shape', () => {
      expect(describeSchema(HashSchema)).toMatchSnapshot();
    });

    it('HashSchema accepts valid SHA-256 hex', () => {
      const hash = 'a'.repeat(64);
      expect(HashSchema.safeParse(hash).success).toBe(true);
    });

    it('HashSchema rejects wrong length', () => {
      expect(HashSchema.safeParse('abc123').success).toBe(false);
    });

    it('CorrelationIdSchema shape', () => {
      expect(describeSchema(CorrelationIdSchema)).toMatchSnapshot();
    });

    it('CorrelationIdSchema accepts valid string', () => {
      expect(CorrelationIdSchema.safeParse('req-12345').success).toBe(true);
    });

    it('CorrelationIdSchema rejects empty string', () => {
      expect(CorrelationIdSchema.safeParse('').success).toBe(false);
    });
  });

  describe('Actor Schemas', () => {
    it('ActorTypeSchema shape', () => {
      expect(describeSchema(ActorTypeSchema)).toMatchSnapshot();
    });

    it('ActorTypeSchema accepts valid types', () => {
      for (const t of ['HUMAN', 'AGENT', 'SYSTEM', 'EXTERNAL']) {
        expect(ActorTypeSchema.safeParse(t).success).toBe(true);
      }
    });

    it('ActorTypeSchema rejects invalid type', () => {
      expect(ActorTypeSchema.safeParse('BOT').success).toBe(false);
    });

    it('ActorSchema shape', () => {
      expect(describeSchema(ActorSchema)).toMatchSnapshot();
    });

    it('ActorSchema accepts valid actor', () => {
      const result = ActorSchema.safeParse({
        type: 'AGENT',
        id: 'agent-001',
        name: 'Test Agent',
      });
      expect(result.success).toBe(true);
    });

    it('ActorSchema rejects missing id', () => {
      const result = ActorSchema.safeParse({ type: 'HUMAN' });
      expect(result.success).toBe(false);
    });
  });

  describe('Trust Band Schema', () => {
    it('TrustBandSchema shape', () => {
      expect(describeSchema(TrustBandSchema)).toMatchSnapshot();
    });

    it('TrustBandSchema accepts all 8 tiers', () => {
      for (let i = 0; i <= 7; i++) {
        expect(TrustBandSchema.safeParse(`T${i}`).success).toBe(true);
      }
    });

    it('TrustBandSchema rejects T8', () => {
      expect(TrustBandSchema.safeParse('T8').success).toBe(false);
    });
  });

  describe('Autonomy Schema', () => {
    it('AutonomyLevelSchema shape', () => {
      expect(describeSchema(AutonomyLevelSchema)).toMatchSnapshot();
    });

    it('AutonomyLevelSchema accepts valid levels', () => {
      for (const l of ['NONE', 'HITL', 'CONSTRAINED', 'SUPERVISED', 'BROAD', 'FULL']) {
        expect(AutonomyLevelSchema.safeParse(l).success).toBe(true);
      }
    });
  });

  describe('Decision Schemas', () => {
    it('DecisionOutcomeSchema shape', () => {
      expect(describeSchema(DecisionOutcomeSchema)).toMatchSnapshot();
    });

    it('DecisionOutcomeSchema accepts PERMIT/DENY/ESCALATE/PENDING', () => {
      for (const d of ['PERMIT', 'DENY', 'ESCALATE', 'PENDING']) {
        expect(DecisionOutcomeSchema.safeParse(d).success).toBe(true);
      }
    });

    it('ExecutionOutcomeSchema shape', () => {
      expect(describeSchema(ExecutionOutcomeSchema)).toMatchSnapshot();
    });

    it('ExecutionOutcomeSchema accepts all outcomes', () => {
      for (const o of ['SUCCESS', 'FAILURE', 'ERROR', 'TIMEOUT', 'CANCELLED', 'BLOCKED']) {
        expect(ExecutionOutcomeSchema.safeParse(o).success).toBe(true);
      }
    });
  });

  describe('Severity & Risk Schemas', () => {
    it('SeveritySchema shape', () => {
      expect(describeSchema(SeveritySchema)).toMatchSnapshot();
    });

    it('SeveritySchema accepts all levels', () => {
      for (const s of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']) {
        expect(SeveritySchema.safeParse(s).success).toBe(true);
      }
    });

    it('RiskLevelSchema shape', () => {
      expect(describeSchema(RiskLevelSchema)).toMatchSnapshot();
    });

    it('RiskLevelSchema accepts all levels', () => {
      for (const r of ['EXTREME', 'HIGH', 'MEDIUM', 'LOW', 'NEGLIGIBLE']) {
        expect(RiskLevelSchema.safeParse(r).success).toBe(true);
      }
    });
  });
});
