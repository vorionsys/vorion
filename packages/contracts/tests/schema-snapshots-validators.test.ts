/**
 * Snapshot tests for validator schemas.
 *
 * Tests enum validators, decision, intent, trust-profile, and proof-event
 * schemas from the validators module.
 */

import { describe, it, expect } from 'vitest';
import { describeSchema } from './helpers/schema-descriptor';

import {
  trustBandSchema,
  observationTierSchema,
  dataSensitivitySchema,
  reversibilitySchema,
  actionTypeSchema,
  proofEventTypeSchema,
  componentTypeSchema,
  componentStatusSchema,
  approvalTypeSchema,
} from '../src/validators/enums';

import {
  rateLimitSchema,
  approvalRequirementSchema,
  decisionConstraintsSchema,
  decisionSchema,
  authorizationRequestSchema,
} from '../src/validators/decision';

import {
  intentContextSchema,
  intentSchema as validatorIntentSchema,
  createIntentRequestSchema as validatorCreateIntentRequestSchema,
} from '../src/validators/intent';

import {
  trustFactorScoresSchema,
  trustEvidenceSchema,
  trustProfileSchema,
  trustCalculationRequestSchema,
} from '../src/validators/trust-profile';

import {
  proofEventPayloadSchema,
  proofEventSchema,
  proofEventFilterSchema,
  logProofEventRequestSchema,
} from '../src/validators/proof-event';

describe('Validator Enum Schemas', () => {
  const schemas = {
    trustBandSchema,
    observationTierSchema,
    dataSensitivitySchema,
    reversibilitySchema,
    actionTypeSchema,
    proofEventTypeSchema,
    componentTypeSchema,
    componentStatusSchema,
    approvalTypeSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }

  it('trustBandSchema accepts all bands', () => {
    for (const band of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(trustBandSchema.safeParse(band).success).toBe(true);
    }
  });

  it('observationTierSchema accepts valid tiers', () => {
    for (const tier of ['BLACK_BOX', 'GRAY_BOX', 'WHITE_BOX', 'ATTESTED_BOX', 'VERIFIED_BOX']) {
      expect(observationTierSchema.safeParse(tier).success).toBe(true);
    }
  });

  it('componentStatusSchema accepts valid statuses', () => {
    for (const s of ['active', 'deprecated', 'retired']) {
      expect(componentStatusSchema.safeParse(s).success).toBe(true);
    }
  });
});

describe('Validator Decision Schemas', () => {
  const schemas = {
    rateLimitSchema,
    approvalRequirementSchema,
    decisionConstraintsSchema,
    decisionSchema,
    authorizationRequestSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('Validator Intent Schemas', () => {
  const schemas = {
    intentContextSchema,
    validatorIntentSchema,
    validatorCreateIntentRequestSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('Validator Trust Profile Schemas', () => {
  const schemas = {
    trustFactorScoresSchema,
    trustEvidenceSchema,
    trustProfileSchema,
    trustCalculationRequestSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('Validator Proof Event Schemas', () => {
  const schemas = {
    proofEventPayloadSchema,
    proofEventSchema,
    proofEventFilterSchema,
    logProofEventRequestSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});
