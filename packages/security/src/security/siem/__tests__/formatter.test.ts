/**
 * Tests for SIEM Event Formatter and Field Normalizer
 *
 * @module security/siem/__tests__/formatter.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventFormatter, FieldNormalizer } from '../formatter.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEvent(overrides: Partial<any> = {}): any {
  return {
    id: 'evt-001',
    timestamp: new Date('2024-01-15T12:00:00Z'),
    eventType: 'LOGIN_SUCCESS',
    category: 'authentication',
    severity: 4, // Medium
    outcome: 'success',
    message: 'User authenticated successfully',
    source: 'vorion',
    sourceIp: '192.168.1.100',
    sourcePort: 54321,
    sourceHost: 'workstation-1',
    destinationIp: '10.0.0.1',
    destinationPort: 443,
    httpMethod: 'POST',
    httpUrl: '/api/auth/login',
    user: { userId: 'user-1', username: 'john', tenantId: 'tenant-1' },
    geo: { country: 'United States', countryCode: 'US', city: 'New York' },
    requestId: 'req-001',
    environment: 'production',
    ...overrides,
  };
}

// =============================================================================
// EventFormatter - JSON Format
// =============================================================================

describe('EventFormatter', () => {
  describe('formatJSON', () => {
    let formatter: EventFormatter;

    beforeEach(() => {
      formatter = new EventFormatter();
    });

    it('returns valid JSON with all fields', () => {
      const event = createTestEvent();
      const result = formatter.formatJSON(event);

      const parsed = JSON.parse(result);
      expect(parsed.id).toBe('evt-001');
      expect(parsed.eventType).toBe('LOGIN_SUCCESS');
      expect(parsed.category).toBe('authentication');
      expect(parsed.severity).toBe(4);
      expect(parsed.outcome).toBe('success');
      expect(parsed.message).toBe('User authenticated successfully');
      expect(parsed.source).toBe('vorion');
      expect(parsed.sourceIp).toBe('192.168.1.100');
      expect(parsed.sourcePort).toBe(54321);
      expect(parsed.destinationIp).toBe('10.0.0.1');
      expect(parsed.destinationPort).toBe(443);
      expect(parsed.httpMethod).toBe('POST');
      expect(parsed.httpUrl).toBe('/api/auth/login');
      expect(parsed.user).toEqual({ userId: 'user-1', username: 'john', tenantId: 'tenant-1' });
      expect(parsed.geo).toEqual({ country: 'United States', countryCode: 'US', city: 'New York' });
      expect(parsed.requestId).toBe('req-001');
      expect(parsed.environment).toBe('production');
    });

    it('converts timestamp to ISO string', () => {
      const event = createTestEvent();
      const result = formatter.formatJSON(event);
      const parsed = JSON.parse(result);

      expect(parsed.timestamp).toBe('2024-01-15T12:00:00.000Z');
      expect(typeof parsed.timestamp).toBe('string');
    });

    it('converts threat dates to ISO strings', () => {
      const event = createTestEvent({
        threat: {
          threatType: 'malware',
          confidence: 85,
          firstSeen: new Date('2024-01-10T08:00:00Z'),
          lastSeen: new Date('2024-01-14T16:30:00Z'),
        },
      });
      const result = formatter.formatJSON(event);
      const parsed = JSON.parse(result);

      expect(parsed.threat.threatType).toBe('malware');
      expect(parsed.threat.confidence).toBe(85);
      expect(parsed.threat.firstSeen).toBe('2024-01-10T08:00:00.000Z');
      expect(parsed.threat.lastSeen).toBe('2024-01-14T16:30:00.000Z');
    });

    it('format("json", event) delegates to formatJSON', () => {
      const event = createTestEvent();
      const jsonResult = formatter.formatJSON(event);
      const formatResult = formatter.format(event, 'json');

      expect(formatResult).toBe(jsonResult);
    });
  });

  // ===========================================================================
  // EventFormatter - CEF Format
  // ===========================================================================

  describe('formatCEF', () => {
    it('starts with "CEF:0|" header', () => {
      const formatter = new EventFormatter();
      const event = createTestEvent();
      const result = formatter.formatCEF(event);

      expect(result.startsWith('CEF:0|')).toBe(true);
    });

    it('uses default vendor/product/version when no config', () => {
      const formatter = new EventFormatter();
      const event = createTestEvent();
      const result = formatter.formatCEF(event);

      // CEF:0|Vendor|Product|Version|EventClassId|Name|Severity|Extension
      const parts = result.split('|');
      expect(parts[1]).toBe('Vorion');
      expect(parts[2]).toBe('SecurityPlatform');
      expect(parts[3]).toBe('1.0');
    });

    it('uses custom CEFConfig values (vendor, product, version)', () => {
      const formatter = new EventFormatter({
        cef: {
          vendor: 'CustomVendor',
          product: 'CustomProduct',
          version: '2.5',
          deviceEventClassIdPrefix: 'SEC-',
        },
      });
      const event = createTestEvent();
      const result = formatter.formatCEF(event);

      const parts = result.split('|');
      expect(parts[1]).toBe('CustomVendor');
      expect(parts[2]).toBe('CustomProduct');
      expect(parts[3]).toBe('2.5');
      // Event class ID should have prefix
      expect(parts[4]).toBe('SEC-LOGIN_SUCCESS');
    });

    it('maps severity correctly: 0->"0", 1->"3", 4->"5", 7->"8", 10->"10"', () => {
      const formatter = new EventFormatter();

      const severityMap: Array<[number, string]> = [
        [0, '0'],
        [1, '3'],
        [4, '5'],
        [7, '8'],
        [10, '10'],
      ];

      for (const [inputSeverity, expectedCef] of severityMap) {
        const event = createTestEvent({ severity: inputSeverity });
        const result = formatter.formatCEF(event);
        // Severity is the 7th pipe-delimited field (index 6)
        const parts = result.split('|');
        expect(parts[6]).toBe(expectedCef);
      }
    });

    it('escapes pipe "|" in header values', () => {
      const formatter = new EventFormatter({
        cef: {
          vendor: 'Vendor|Pipe',
          product: 'Product|Test',
          version: '1.0',
        },
      });
      const event = createTestEvent();
      const result = formatter.formatCEF(event);

      // The escaped values should use \| inside the header
      expect(result).toContain('Vendor\\|Pipe');
      expect(result).toContain('Product\\|Test');
    });

    it('includes extension fields (src, dst, spt, dpt, suser, outcome, cat)', () => {
      const formatter = new EventFormatter();
      const event = createTestEvent();
      const result = formatter.formatCEF(event);

      // Extension is everything after the 7th pipe
      const extensionPart = result.split('|').slice(7).join('|');

      expect(extensionPart).toContain('src=192.168.1.100');
      expect(extensionPart).toContain('dst=10.0.0.1');
      expect(extensionPart).toContain('spt=54321');
      expect(extensionPart).toContain('dpt=443');
      expect(extensionPart).toContain('suser=john');
      expect(extensionPart).toContain('outcome=success');
      expect(extensionPart).toContain('cat=authentication');
    });

    it('escapes "=" and "\\" in extension values', () => {
      const formatter = new EventFormatter();
      const event = createTestEvent({
        description: 'key=value with backslash\\end',
      });
      const result = formatter.formatCEF(event);

      // The extension msg field should have escaped = and \
      expect(result).toContain('msg=key\\=value with backslash\\\\end');
    });

    it('includes custom fields cs1-cs6 (tenantId, requestId, environment, country, city, threatType)', () => {
      const formatter = new EventFormatter();
      const event = createTestEvent({
        threat: { threatType: 'brute_force' },
      });
      const result = formatter.formatCEF(event);
      const extensionPart = result.split('|').slice(7).join('|');

      // cs1 = tenantId
      expect(extensionPart).toContain('cs1=tenant-1');
      expect(extensionPart).toContain('cs1Label=TenantId');
      // cs2 = requestId
      expect(extensionPart).toContain('cs2=req-001');
      expect(extensionPart).toContain('cs2Label=RequestId');
      // cs3 = environment
      expect(extensionPart).toContain('cs3=production');
      expect(extensionPart).toContain('cs3Label=Environment');
      // cs4 = country
      expect(extensionPart).toContain('cs4=United States');
      expect(extensionPart).toContain('cs4Label=Country');
      // cs5 = city
      expect(extensionPart).toContain('cs5=New York');
      expect(extensionPart).toContain('cs5Label=City');
      // cs6 = threatType
      expect(extensionPart).toContain('cs6=brute_force');
      expect(extensionPart).toContain('cs6Label=ThreatType');
    });
  });

  // ===========================================================================
  // EventFormatter - Syslog Format
  // ===========================================================================

  describe('formatSyslog', () => {
    it('follows RFC 5424 format: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [SD] MSG', () => {
      const formatter = new EventFormatter({
        syslog: {
          facility: 1,
          appName: 'vorion',
          procId: '1234',
          msgId: 'AUTH',
          includeStructuredData: false,
        },
      });
      const event = createTestEvent();
      const result = formatter.formatSyslog(event);

      // PRI = facility * 8 + syslogSeverity = 1 * 8 + 4 = 12 (severity 4 maps to syslog 4)
      // Format: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD MSG
      const match = result.match(
        /^<(\d+)>(\d+) (\S+) (\S+) (\S+) (\S+) (\S+) (-|\[.+\]) (.+)$/
      );
      expect(match).not.toBeNull();
      if (match) {
        expect(match[2]).toBe('1'); // VERSION
        expect(match[3]).toBe('2024-01-15T12:00:00.000Z'); // TIMESTAMP
        expect(match[4]).toBe('workstation-1'); // HOSTNAME (sourceHost)
        expect(match[5]).toBe('vorion'); // APP-NAME
        expect(match[6]).toBe('1234'); // PROCID
        expect(match[7]).toBe('AUTH'); // MSGID
        expect(match[9]).toBe('User authenticated successfully'); // MSG
      }
    });

    it('calculates PRI correctly: facility * 8 + severity', () => {
      // Test multiple severity levels with facility=1
      const severityToPri: Array<[number, number]> = [
        [0, 1 * 8 + 6],   // Unknown -> Informational(6) => 14
        [1, 1 * 8 + 5],   // Low -> Notice(5) => 13
        [4, 1 * 8 + 4],   // Medium -> Warning(4) => 12
        [7, 1 * 8 + 3],   // High -> Error(3) => 11
        [10, 1 * 8 + 2],  // Critical -> Critical(2) => 10
      ];

      for (const [inputSeverity, expectedPri] of severityToPri) {
        const formatter = new EventFormatter({
          syslog: { facility: 1, appName: 'vorion', includeStructuredData: false },
        });
        const event = createTestEvent({ severity: inputSeverity });
        const result = formatter.formatSyslog(event);

        expect(result.startsWith(`<${expectedPri}>`)).toBe(true);
      }
    });

    it('includes structured data with event@47450 element', () => {
      const formatter = new EventFormatter({
        syslog: { facility: 1, appName: 'vorion', includeStructuredData: true },
      });
      const event = createTestEvent();
      const result = formatter.formatSyslog(event);

      expect(result).toContain('[event@47450');
      expect(result).toContain('id="evt-001"');
      expect(result).toContain('type="LOGIN_SUCCESS"');
      expect(result).toContain('category="authentication"');
      expect(result).toContain('severity="4"');
      expect(result).toContain('outcome="success"');
    });

    it('includes network, user, and geo structured data when present', () => {
      const formatter = new EventFormatter({
        syslog: { facility: 1, appName: 'vorion', includeStructuredData: true },
      });
      const event = createTestEvent();
      const result = formatter.formatSyslog(event);

      // Network structured data
      expect(result).toContain('[network@47450');
      expect(result).toContain('srcIp="192.168.1.100"');
      expect(result).toContain('srcPort="54321"');
      expect(result).toContain('dstIp="10.0.0.1"');
      expect(result).toContain('dstPort="443"');

      // User structured data
      expect(result).toContain('[user@47450');
      expect(result).toContain('id="user-1"');
      expect(result).toContain('name="john"');
      expect(result).toContain('tenantId="tenant-1"');

      // Geo structured data
      expect(result).toContain('[geo@47450');
      expect(result).toContain('country="United States"');
      expect(result).toContain('city="New York"');
    });

    it('returns "-" for structured data when includeStructuredData=false', () => {
      const formatter = new EventFormatter({
        syslog: { facility: 1, appName: 'vorion', includeStructuredData: false },
      });
      const event = createTestEvent();
      const result = formatter.formatSyslog(event);

      // Structured data section should be '-'
      // The pattern is: <PRI>1 TIMESTAMP HOSTNAME APP PROCID MSGID - MSG
      const parts = result.split(' ');
      // Find the '-' that represents empty structured data
      // After MSGID (which is event.eventType by default), the next token is SD
      const msgIdIndex = parts.findIndex((p) => p === event.eventType);
      expect(parts[msgIdIndex + 1]).toBe('-');
    });
  });
});

// =============================================================================
// FieldNormalizer
// =============================================================================

describe('FieldNormalizer', () => {
  it('normalize returns event unchanged when no mappings', () => {
    const normalizer = new FieldNormalizer();
    const event = createTestEvent({
      customFields: { originalField: 'value1', anotherField: 'value2' },
    });
    const result = normalizer.normalize(event);

    expect(result).toBe(event); // Same reference since no mappings
  });

  it('normalize maps field names in customFields according to mappings', () => {
    const normalizer = new FieldNormalizer({
      src_ip: 'sourceIp',
      dst_ip: 'destinationIp',
      usr: 'username',
    });
    const event = createTestEvent({
      customFields: {
        src_ip: '10.0.0.5',
        dst_ip: '10.0.0.10',
        usr: 'admin',
        unmapped: 'stays',
      },
    });
    const result = normalizer.normalize(event);

    expect(result.customFields).toEqual({
      sourceIp: '10.0.0.5',
      destinationIp: '10.0.0.10',
      username: 'admin',
      unmapped: 'stays',
    });
    // Original event should not be mutated (spread used internally)
    expect(event.customFields!.src_ip).toBe('10.0.0.5');
  });

  it('addMapping, removeMapping, and getMappings work correctly', () => {
    const normalizer = new FieldNormalizer();

    // Initially empty
    expect(normalizer.getMappings()).toEqual({});

    // Add mappings
    normalizer.addMapping('src', 'sourceIp');
    normalizer.addMapping('dst', 'destinationIp');
    expect(normalizer.getMappings()).toEqual({
      src: 'sourceIp',
      dst: 'destinationIp',
    });

    // Remove a mapping
    normalizer.removeMapping('src');
    expect(normalizer.getMappings()).toEqual({
      dst: 'destinationIp',
    });

    // getMappings returns a copy, not a reference
    const mappings = normalizer.getMappings();
    mappings['injected'] = 'value';
    expect(normalizer.getMappings()).toEqual({
      dst: 'destinationIp',
    });
  });
});
