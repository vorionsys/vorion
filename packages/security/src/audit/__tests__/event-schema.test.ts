/**
 * Tests for Audit Event Schema Types and Helper Functions
 *
 * Validates:
 * - Security event type definitions have required fields
 * - All categories and SOC 2 controls are covered
 * - Helper functions return correct metadata and filter correctly
 * - Type guard correctly identifies valid/invalid event types
 * - Audit event type constants from types.ts are well-formed
 * - Zod schemas for security actors, resources, and events validate correctly
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';

import {
  SECURITY_EVENT_TYPES,
  AUTHENTICATION_EVENT_TYPES,
  AUTHORIZATION_EVENT_TYPES,
  DATA_ACCESS_EVENT_TYPES,
  CONFIGURATION_EVENT_TYPES,
  INCIDENT_EVENT_TYPES,
  SECURITY_EVENT_CATEGORIES,
  SECURITY_SEVERITIES,
  SECURITY_OUTCOMES,
  getSecurityEventDefinition,
  getSecurityEventsByCategory,
  getSecurityEventsBySeverity,
  isValidSecurityEventType,
  getAllSecurityEventTypes,
  getSoc2Control,
  securityActorSchema,
  securityResourceSchema,
  securityEventSchema,
} from '../security-events.js';

import {
  AUDIT_EVENT_TYPES,
  AUDIT_SEVERITIES,
  AUDIT_OUTCOMES,
  AUDIT_CATEGORIES,
  ACTOR_TYPES,
  TARGET_TYPES,
} from '../types.js';

// =============================================================================
// Security Event Type Definitions
// =============================================================================

describe('Security Event Type Definitions', () => {
  it('every event type has required fields: category, severity, description, soc2Control', () => {
    const allTypes = Object.entries(SECURITY_EVENT_TYPES);
    expect(allTypes.length).toBeGreaterThan(0);

    for (const [eventName, def] of allTypes) {
      expect(def, `${eventName} missing category`).toHaveProperty('category');
      expect(def, `${eventName} missing severity`).toHaveProperty('severity');
      expect(def, `${eventName} missing description`).toHaveProperty('description');
      expect(def, `${eventName} missing soc2Control`).toHaveProperty('soc2Control');

      expect(typeof def.category).toBe('string');
      expect(typeof def.severity).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(typeof def.soc2Control).toBe('string');
    }
  });

  it('every category in SECURITY_EVENT_CATEGORIES is covered by at least one event type', () => {
    const categoriesInEvents = new Set(
      Object.values(SECURITY_EVENT_TYPES).map((def) => def.category)
    );

    for (const category of SECURITY_EVENT_CATEGORIES) {
      expect(
        categoriesInEvents.has(category),
        `category "${category}" has no event types`
      ).toBe(true);
    }
  });

  it('all required SOC 2 controls are covered', () => {
    const requiredControls = ['CC6.1', 'CC6.2', 'CC6.5', 'CC7.2', 'CC7.3', 'CC8.1'];
    const controlsInEvents = new Set(
      Object.values(SECURITY_EVENT_TYPES).map((def) => def.soc2Control)
    );

    for (const control of requiredControls) {
      expect(
        controlsInEvents.has(control),
        `SOC 2 control "${control}" is not covered by any event type`
      ).toBe(true);
    }
  });

  it('SECURITY_EVENT_TYPES is the union of all category-specific constants', () => {
    const categoryKeys = [
      ...Object.keys(AUTHENTICATION_EVENT_TYPES),
      ...Object.keys(AUTHORIZATION_EVENT_TYPES),
      ...Object.keys(DATA_ACCESS_EVENT_TYPES),
      ...Object.keys(CONFIGURATION_EVENT_TYPES),
      ...Object.keys(INCIDENT_EVENT_TYPES),
    ];

    const combinedKeys = Object.keys(SECURITY_EVENT_TYPES);
    expect(combinedKeys.sort()).toEqual(categoryKeys.sort());
  });
});

// =============================================================================
// Category-Specific Event Type Constants
// =============================================================================

describe('Category-Specific Event Type Constants', () => {
  it('AUTHENTICATION_EVENT_TYPES all have category "authentication"', () => {
    for (const [name, def] of Object.entries(AUTHENTICATION_EVENT_TYPES)) {
      expect(def.category, `${name} has wrong category`).toBe('authentication');
    }
  });

  it('AUTHORIZATION_EVENT_TYPES all have category "authorization"', () => {
    for (const [name, def] of Object.entries(AUTHORIZATION_EVENT_TYPES)) {
      expect(def.category, `${name} has wrong category`).toBe('authorization');
    }
  });

  it('DATA_ACCESS_EVENT_TYPES all have category "data_access"', () => {
    for (const [name, def] of Object.entries(DATA_ACCESS_EVENT_TYPES)) {
      expect(def.category, `${name} has wrong category`).toBe('data_access');
    }
  });

  it('CONFIGURATION_EVENT_TYPES all have category "configuration"', () => {
    for (const [name, def] of Object.entries(CONFIGURATION_EVENT_TYPES)) {
      expect(def.category, `${name} has wrong category`).toBe('configuration');
    }
  });

  it('INCIDENT_EVENT_TYPES all have category "incident"', () => {
    for (const [name, def] of Object.entries(INCIDENT_EVENT_TYPES)) {
      expect(def.category, `${name} has wrong category`).toBe('incident');
    }
  });
});

// =============================================================================
// getSecurityEventDefinition
// =============================================================================

describe('getSecurityEventDefinition', () => {
  it('returns correct metadata for LOGIN_SUCCESS', () => {
    const def = getSecurityEventDefinition('LOGIN_SUCCESS');
    expect(def.category).toBe('authentication');
    expect(def.severity).toBe('info');
    expect(def.description).toBe('User successfully authenticated');
    expect(def.soc2Control).toBe('CC6.1');
  });

  it('returns correct metadata for ACCESS_DENIED', () => {
    const def = getSecurityEventDefinition('ACCESS_DENIED');
    expect(def.category).toBe('authorization');
    expect(def.severity).toBe('medium');
    expect(def.description).toBe('Access denied to resource');
    expect(def.soc2Control).toBe('CC6.2');
  });

  it('returns correct metadata for BRUTE_FORCE_DETECTED', () => {
    const def = getSecurityEventDefinition('BRUTE_FORCE_DETECTED');
    expect(def.category).toBe('incident');
    expect(def.severity).toBe('critical');
    expect(def.description).toBe('Brute force attack detected');
    expect(def.soc2Control).toBe('CC7.2');
  });
});

// =============================================================================
// getSecurityEventsByCategory
// =============================================================================

describe('getSecurityEventsByCategory', () => {
  it('returns authentication event types for category "authentication"', () => {
    const authEvents = getSecurityEventsByCategory('authentication');
    expect(authEvents.length).toBeGreaterThan(0);

    const authKeys = Object.keys(AUTHENTICATION_EVENT_TYPES);
    expect(authEvents.sort()).toEqual(authKeys.sort());
  });

  it('returns incident event types for category "incident"', () => {
    const incidentEvents = getSecurityEventsByCategory('incident');
    expect(incidentEvents.length).toBeGreaterThan(0);

    const incidentKeys = Object.keys(INCIDENT_EVENT_TYPES);
    expect(incidentEvents.sort()).toEqual(incidentKeys.sort());
  });

  it('all returned event types actually belong to the requested category', () => {
    for (const category of SECURITY_EVENT_CATEGORIES) {
      const events = getSecurityEventsByCategory(category);
      for (const eventType of events) {
        const def = SECURITY_EVENT_TYPES[eventType];
        expect(def.category, `${eventType} should be in category "${category}"`).toBe(category);
      }
    }
  });
});

// =============================================================================
// getSecurityEventsBySeverity
// =============================================================================

describe('getSecurityEventsBySeverity', () => {
  it('returns critical events including known critical types', () => {
    const criticalEvents = getSecurityEventsBySeverity('critical');
    expect(criticalEvents.length).toBeGreaterThan(0);

    const expectedCritical = [
      'BRUTE_FORCE_DETECTED',
      'INJECTION_ATTEMPT',
      'KEY_REVOKED',
      'INCIDENT_CREATED',
      'INTEGRITY_VIOLATION',
    ];

    for (const eventType of expectedCritical) {
      expect(
        criticalEvents,
        `critical events should include ${eventType}`
      ).toContain(eventType);
    }
  });

  it('all returned event types actually have the requested severity', () => {
    for (const severity of SECURITY_SEVERITIES) {
      const events = getSecurityEventsBySeverity(severity);
      for (const eventType of events) {
        const def = SECURITY_EVENT_TYPES[eventType];
        expect(def.severity, `${eventType} should have severity "${severity}"`).toBe(severity);
      }
    }
  });
});

// =============================================================================
// isValidSecurityEventType
// =============================================================================

describe('isValidSecurityEventType', () => {
  it('returns true for valid event types', () => {
    expect(isValidSecurityEventType('LOGIN_SUCCESS')).toBe(true);
    expect(isValidSecurityEventType('ACCESS_DENIED')).toBe(true);
    expect(isValidSecurityEventType('BRUTE_FORCE_DETECTED')).toBe(true);
    expect(isValidSecurityEventType('DATA_READ')).toBe(true);
    expect(isValidSecurityEventType('CONFIG_CHANGED')).toBe(true);
  });

  it('returns false for invalid event types', () => {
    expect(isValidSecurityEventType('INVALID_TYPE')).toBe(false);
    expect(isValidSecurityEventType('')).toBe(false);
    expect(isValidSecurityEventType('login_success')).toBe(false);
    expect(isValidSecurityEventType('NOT_A_REAL_EVENT')).toBe(false);
  });
});

// =============================================================================
// getAllSecurityEventTypes
// =============================================================================

describe('getAllSecurityEventTypes', () => {
  it('returns a non-empty array', () => {
    const allTypes = getAllSecurityEventTypes();
    expect(Array.isArray(allTypes)).toBe(true);
    expect(allTypes.length).toBeGreaterThan(0);
  });

  it('returns all keys from SECURITY_EVENT_TYPES', () => {
    const allTypes = getAllSecurityEventTypes();
    const expectedKeys = Object.keys(SECURITY_EVENT_TYPES);
    expect(allTypes.sort()).toEqual(expectedKeys.sort());
  });

  it('every returned type is a valid security event type', () => {
    const allTypes = getAllSecurityEventTypes();
    for (const eventType of allTypes) {
      expect(isValidSecurityEventType(eventType)).toBe(true);
    }
  });
});

// =============================================================================
// getSoc2Control
// =============================================================================

describe('getSoc2Control', () => {
  it('returns CC6.1 for LOGIN_SUCCESS', () => {
    expect(getSoc2Control('LOGIN_SUCCESS')).toBe('CC6.1');
  });

  it('returns CC6.2 for ACCESS_DENIED', () => {
    expect(getSoc2Control('ACCESS_DENIED')).toBe('CC6.2');
  });

  it('returns CC6.5 for DATA_READ', () => {
    expect(getSoc2Control('DATA_READ')).toBe('CC6.5');
  });

  it('returns CC8.1 for CONFIG_CHANGED', () => {
    expect(getSoc2Control('CONFIG_CHANGED')).toBe('CC8.1');
  });

  it('returns CC7.2 for BRUTE_FORCE_DETECTED', () => {
    expect(getSoc2Control('BRUTE_FORCE_DETECTED')).toBe('CC7.2');
  });

  it('returns CC7.3 for INCIDENT_CREATED', () => {
    expect(getSoc2Control('INCIDENT_CREATED')).toBe('CC7.3');
  });
});

// =============================================================================
// Security Constants
// =============================================================================

describe('Security Constants', () => {
  it('SECURITY_EVENT_CATEGORIES has all five categories', () => {
    expect([...SECURITY_EVENT_CATEGORIES]).toEqual([
      'authentication',
      'authorization',
      'data_access',
      'configuration',
      'incident',
    ]);
  });

  it('SECURITY_SEVERITIES has all five levels', () => {
    expect([...SECURITY_SEVERITIES]).toEqual(['info', 'low', 'medium', 'high', 'critical']);
  });

  it('SECURITY_OUTCOMES has all four outcomes', () => {
    expect([...SECURITY_OUTCOMES]).toEqual(['success', 'failure', 'blocked', 'escalated']);
  });
});

// =============================================================================
// Zod Schema Validation
// =============================================================================

describe('Zod Schema Validation', () => {
  it('securityActorSchema accepts a valid actor', () => {
    const validActor = {
      type: 'user',
      id: 'usr_123',
      name: 'Test User',
      email: 'test@example.com',
      ip: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      sessionId: 'sess_abc',
      tenantId: 'ten_456',
    };

    const result = securityActorSchema.parse(validActor);
    expect(result.type).toBe('user');
    expect(result.id).toBe('usr_123');
    expect(result.email).toBe('test@example.com');
  });

  it('securityActorSchema accepts minimal required fields', () => {
    const minimal = { type: 'system', id: 'sys_001' };
    const result = securityActorSchema.parse(minimal);
    expect(result.type).toBe('system');
    expect(result.id).toBe('sys_001');
    expect(result.name).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it('securityActorSchema rejects invalid actor type', () => {
    const invalid = { type: 'superuser', id: '123' };
    expect(() => securityActorSchema.parse(invalid)).toThrow();
  });

  it('securityActorSchema rejects invalid email format', () => {
    const invalid = { type: 'user', id: '123', email: 'not-an-email' };
    expect(() => securityActorSchema.parse(invalid)).toThrow();
  });

  it('securityResourceSchema accepts a valid resource', () => {
    const validResource = {
      type: 'document',
      id: 'doc_789',
      name: 'Quarterly Report',
      path: '/reports/q1',
      attributes: { department: 'finance', confidential: true },
    };

    const result = securityResourceSchema.parse(validResource);
    expect(result.type).toBe('document');
    expect(result.id).toBe('doc_789');
    expect(result.attributes).toEqual({ department: 'finance', confidential: true });
  });

  it('securityResourceSchema accepts minimal required fields', () => {
    const minimal = { type: 'api', id: 'api_001' };
    const result = securityResourceSchema.parse(minimal);
    expect(result.type).toBe('api');
    expect(result.id).toBe('api_001');
    expect(result.name).toBeUndefined();
    expect(result.path).toBeUndefined();
    expect(result.attributes).toBeUndefined();
  });

  it('securityEventSchema accepts a fully-formed security event', () => {
    const validEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2026-02-23T12:00:00Z',
      eventType: 'LOGIN_SUCCESS',
      category: 'authentication',
      severity: 'info',
      actor: { type: 'user', id: 'usr_123' },
      action: 'user.login',
      resource: { type: 'session', id: 'sess_456' },
      outcome: 'success',
      metadata: { browser: 'Chrome' },
      requestId: 'req_789',
      traceId: 'trace_abc',
      soc2Control: 'CC6.1',
    };

    const result = securityEventSchema.parse(validEvent);
    expect(result.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.eventType).toBe('LOGIN_SUCCESS');
    expect(result.category).toBe('authentication');
    expect(result.outcome).toBe('success');
  });

  it('securityEventSchema defaults metadata to empty object', () => {
    const event = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2026-02-23T12:00:00Z',
      eventType: 'ACCESS_DENIED',
      category: 'authorization',
      severity: 'medium',
      actor: { type: 'agent', id: 'agent_001' },
      action: 'resource.access',
      resource: { type: 'api', id: 'api_001' },
      outcome: 'failure',
      requestId: 'req_001',
    };

    const result = securityEventSchema.parse(event);
    expect(result.metadata).toEqual({});
  });

  it('securityEventSchema rejects invalid category', () => {
    const invalid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2026-02-23T12:00:00Z',
      eventType: 'LOGIN_SUCCESS',
      category: 'unknown_category',
      severity: 'info',
      actor: { type: 'user', id: 'usr_123' },
      action: 'login',
      resource: { type: 'session', id: 'sess_1' },
      outcome: 'success',
      requestId: 'req_1',
    };

    expect(() => securityEventSchema.parse(invalid)).toThrow();
  });

  it('securityEventSchema rejects invalid outcome', () => {
    const invalid = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2026-02-23T12:00:00Z',
      eventType: 'LOGIN_SUCCESS',
      category: 'authentication',
      severity: 'info',
      actor: { type: 'user', id: 'usr_123' },
      action: 'login',
      resource: { type: 'session', id: 'sess_1' },
      outcome: 'maybe',
      requestId: 'req_1',
    };

    expect(() => securityEventSchema.parse(invalid)).toThrow();
  });
});

// =============================================================================
// Audit Types (from types.ts)
// =============================================================================

describe('AUDIT_EVENT_TYPES', () => {
  it('has all expected categories represented', () => {
    const categoriesInAudit = new Set(
      Object.values(AUDIT_EVENT_TYPES).map((def) => def.category)
    );

    for (const category of AUDIT_CATEGORIES) {
      expect(
        categoriesInAudit.has(category),
        `AUDIT_EVENT_TYPES should have events for category "${category}"`
      ).toBe(true);
    }
  });

  it('every entry has a category from AUDIT_CATEGORIES', () => {
    const validCategories = new Set<string>(AUDIT_CATEGORIES);

    for (const [eventName, def] of Object.entries(AUDIT_EVENT_TYPES)) {
      expect(
        validCategories.has(def.category),
        `${eventName} has invalid category "${def.category}"`
      ).toBe(true);
    }
  });

  it('every entry has a severity from AUDIT_SEVERITIES', () => {
    const validSeverities = new Set<string>(AUDIT_SEVERITIES);

    for (const [eventName, def] of Object.entries(AUDIT_EVENT_TYPES)) {
      expect(
        validSeverities.has(def.severity),
        `${eventName} has invalid severity "${def.severity}"`
      ).toBe(true);
    }
  });

  it('contains the expected number of event types', () => {
    const count = Object.keys(AUDIT_EVENT_TYPES).length;
    expect(count).toBe(61);
  });
});

describe('Audit Constants', () => {
  it('AUDIT_SEVERITIES has expected values', () => {
    expect([...AUDIT_SEVERITIES]).toEqual(['info', 'warning', 'error', 'critical']);
  });

  it('AUDIT_OUTCOMES has expected values', () => {
    expect([...AUDIT_OUTCOMES]).toEqual(['success', 'failure', 'partial']);
  });

  it('AUDIT_CATEGORIES has expected values', () => {
    expect([...AUDIT_CATEGORIES]).toEqual([
      'intent',
      'policy',
      'escalation',
      'authentication',
      'authorization',
      'data',
      'system',
      'admin',
    ]);
  });

  it('ACTOR_TYPES has expected values', () => {
    expect([...ACTOR_TYPES]).toEqual(['user', 'agent', 'service', 'system']);
  });

  it('TARGET_TYPES has expected values', () => {
    expect([...TARGET_TYPES]).toEqual([
      'intent',
      'policy',
      'escalation',
      'entity',
      'tenant',
      'user',
      'system',
    ]);
  });
});
