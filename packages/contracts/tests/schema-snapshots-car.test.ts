/**
 * Snapshot tests for CAR (Categorical Agentic Registry) schemas.
 *
 * Tests domain codes, skills, capability levels, tiers, CAR string,
 * attestation, identity, JWT claims, effective permissions, and mapping schemas.
 */

import { describe, it, expect } from 'vitest';
import { describeSchema } from './helpers/schema-descriptor';

import {
  domainCodeSchema,
  domainDefinitionSchema,
  domainCodeArraySchema,
  domainBitmaskSchema,
} from '../src/car/domains';

import {
  skillCodeSchema,
  skillDefinitionSchema,
  skillCodeArraySchema,
  skillBitmaskSchema,
} from '../src/car/skills';

import {
  capabilityLevelSchema,
  capabilityLevelConfigSchema,
} from '../src/car/levels';

import {
  certificationTierSchema,
  runtimeTierSchema,
  certificationTierConfigSchema,
  runtimeTierConfigSchema,
} from '../src/car/tiers';

import {
  parsedCARSchema,
  carStringSchema,
  generateCAROptionsSchema,
  carValidationErrorSchema,
  carValidationWarningSchema,
  carValidationResultSchema,
} from '../src/car/car-string';

import {
  attestationScopeSchema,
  attestationStatusSchema,
  attestationEvidenceSchema,
  attestationProofSchema,
  attestationSchema,
  attestationVerificationErrorSchema,
  attestationVerificationWarningSchema,
  attestationVerificationResultSchema,
} from '../src/car/attestation';

import {
  capabilityVectorSchema,
  agentMetadataSchema,
  verificationMethodSchema,
  serviceEndpointSchema,
  agentIdentitySchema,
  agentIdentitySummarySchema,
  agentRegistrationOptionsSchema,
  agentMatchCriteriaSchema,
} from '../src/car/identity';

import {
  standardJWTClaimsSchema,
  carAttestationClaimSchema,
  carConstraintsClaimSchema,
  jwtClaimsValidationOptionsSchema,
  jwtClaimsValidationErrorSchema,
  jwtClaimsValidationResultSchema,
} from '../src/car/jwt-claims';

import {
  effectivePermissionContextSchema,
  constrainingFactorSchema,
  permissionCeilingsSchema,
  effectivePermissionSchema,
  permissionCheckResultSchema,
} from '../src/car/effective-permission';

import {
  vorionNamespaceSchema,
  tierMappingResultSchema,
  domainMappingResultSchema,
} from '../src/car/mapping';

describe('CAR Domain Schemas', () => {
  const schemas = {
    domainCodeSchema,
    domainDefinitionSchema,
    domainCodeArraySchema,
    domainBitmaskSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }

  it('domainCodeSchema accepts valid code', () => {
    expect(domainCodeSchema.safeParse('A').success).toBe(true);
  });

  it('domainBitmaskSchema accepts number', () => {
    expect(domainBitmaskSchema.safeParse(255).success).toBe(true);
  });
});

describe('CAR Skill Schemas', () => {
  const schemas = {
    skillCodeSchema,
    skillDefinitionSchema,
    skillCodeArraySchema,
    skillBitmaskSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('CAR Level Schemas', () => {
  const schemas = {
    capabilityLevelSchema,
    capabilityLevelConfigSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('CAR Tier Schemas', () => {
  const schemas = {
    certificationTierSchema,
    runtimeTierSchema,
    certificationTierConfigSchema,
    runtimeTierConfigSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('CAR String Schemas', () => {
  const schemas = {
    parsedCARSchema,
    carStringSchema,
    generateCAROptionsSchema,
    carValidationErrorSchema,
    carValidationWarningSchema,
    carValidationResultSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }

  it('carStringSchema accepts valid CAR string', () => {
    expect(
      carStringSchema.safeParse('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0').success,
    ).toBe(true);
  });
});

describe('CAR Attestation Schemas', () => {
  const schemas = {
    attestationScopeSchema,
    attestationStatusSchema,
    attestationEvidenceSchema,
    attestationProofSchema,
    attestationSchema,
    attestationVerificationErrorSchema,
    attestationVerificationWarningSchema,
    attestationVerificationResultSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('CAR Identity Schemas', () => {
  const schemas = {
    capabilityVectorSchema,
    agentMetadataSchema,
    verificationMethodSchema,
    serviceEndpointSchema,
    agentIdentitySchema,
    agentIdentitySummarySchema,
    agentRegistrationOptionsSchema,
    agentMatchCriteriaSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('CAR JWT Claims Schemas', () => {
  const schemas = {
    standardJWTClaimsSchema,
    carAttestationClaimSchema,
    carConstraintsClaimSchema,
    jwtClaimsValidationOptionsSchema,
    jwtClaimsValidationErrorSchema,
    jwtClaimsValidationResultSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('CAR Effective Permission Schemas', () => {
  const schemas = {
    effectivePermissionContextSchema,
    constrainingFactorSchema,
    permissionCeilingsSchema,
    effectivePermissionSchema,
    permissionCheckResultSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});

describe('CAR Mapping Schemas', () => {
  const schemas = {
    vorionNamespaceSchema,
    tierMappingResultSchema,
    domainMappingResultSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} shape matches snapshot`, () => {
      expect(describeSchema(schema)).toMatchSnapshot();
    });
  }
});
