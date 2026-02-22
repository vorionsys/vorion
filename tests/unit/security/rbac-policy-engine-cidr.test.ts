/**
 * RBAC Policy Engine - CIDR IP Address Matching Tests
 *
 * Tests for the matchIpAddress method which supports:
 * - Wildcard '*' matching
 * - Exact IP string matching
 * - IPv4 CIDR notation (e.g., "192.168.1.0/24")
 * - IPv6 CIDR notation (e.g., "fe80::/10")
 * - Edge cases (invalid input, missing prefix, family mismatch)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies used by RBACPolicyEngine constructor
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/common/trace.js', () => ({
  withSpan: vi.fn((_name: string, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/audit/security-logger.js', () => ({
  getSecurityAuditLogger: () => ({
    logAccessDecision: vi.fn(),
    logPermissionCheck: vi.fn(),
    logRoleChange: vi.fn(),
    logPolicyEvaluation: vi.fn(),
  }),
  SecurityAuditLogger: vi.fn(),
}));

import { RBACPolicyEngine } from '../../../src/security/rbac/policy-engine.js';

describe('RBACPolicyEngine - matchIpAddress (CIDR support)', () => {
  let engine: RBACPolicyEngine;

  // Access the private method via type coercion for unit testing
  function matchIpAddress(ip: string, pattern: string): boolean {
    return (engine as unknown as { matchIpAddress(ip: string, pattern: string): boolean })
      .matchIpAddress(ip, pattern);
  }

  beforeEach(() => {
    engine = new RBACPolicyEngine({
      enableAuditLogging: false,
      enableTracing: false,
      enableCaching: false,
    });
  });

  // ===========================================================================
  // WILDCARD
  // ===========================================================================

  describe('wildcard matching', () => {
    it('should match any IPv4 address with wildcard "*"', () => {
      expect(matchIpAddress('192.168.1.42', '*')).toBe(true);
    });

    it('should match any IPv6 address with wildcard "*"', () => {
      expect(matchIpAddress('fe80::1', '*')).toBe(true);
    });
  });

  // ===========================================================================
  // IPv4 EXACT MATCH
  // ===========================================================================

  describe('IPv4 exact match', () => {
    it('should match identical IPv4 addresses', () => {
      expect(matchIpAddress('10.0.0.1', '10.0.0.1')).toBe(true);
    });

    it('should not match different IPv4 addresses', () => {
      expect(matchIpAddress('10.0.0.1', '10.0.0.2')).toBe(false);
    });

    it('should treat bare IPv4 as /32 (exact host match)', () => {
      expect(matchIpAddress('192.168.1.1', '192.168.1.1')).toBe(true);
      expect(matchIpAddress('192.168.1.2', '192.168.1.1')).toBe(false);
    });
  });

  // ===========================================================================
  // IPv4 CIDR
  // ===========================================================================

  describe('IPv4 CIDR notation', () => {
    it('should match IP within /24 subnet', () => {
      expect(matchIpAddress('192.168.1.42', '192.168.1.0/24')).toBe(true);
      expect(matchIpAddress('192.168.1.0', '192.168.1.0/24')).toBe(true);
      expect(matchIpAddress('192.168.1.255', '192.168.1.0/24')).toBe(true);
    });

    it('should not match IP outside /24 subnet', () => {
      expect(matchIpAddress('192.168.2.1', '192.168.1.0/24')).toBe(false);
      expect(matchIpAddress('10.0.0.1', '192.168.1.0/24')).toBe(false);
    });

    it('should match IP within /16 subnet', () => {
      expect(matchIpAddress('172.16.0.1', '172.16.0.0/16')).toBe(true);
      expect(matchIpAddress('172.16.255.255', '172.16.0.0/16')).toBe(true);
    });

    it('should not match IP outside /16 subnet', () => {
      expect(matchIpAddress('172.17.0.1', '172.16.0.0/16')).toBe(false);
    });

    it('should match IP within /8 subnet', () => {
      expect(matchIpAddress('10.255.255.255', '10.0.0.0/8')).toBe(true);
      expect(matchIpAddress('10.0.0.0', '10.0.0.0/8')).toBe(true);
    });

    it('should not match IP outside /8 subnet', () => {
      expect(matchIpAddress('11.0.0.1', '10.0.0.0/8')).toBe(false);
    });

    it('should match /32 as exact host', () => {
      expect(matchIpAddress('10.0.0.5', '10.0.0.5/32')).toBe(true);
      expect(matchIpAddress('10.0.0.6', '10.0.0.5/32')).toBe(false);
    });

    it('should match /0 as any address', () => {
      expect(matchIpAddress('1.2.3.4', '0.0.0.0/0')).toBe(true);
      expect(matchIpAddress('255.255.255.255', '0.0.0.0/0')).toBe(true);
    });

    it('should handle non-standard CIDR boundaries (e.g., /20)', () => {
      // 192.168.0.0/20 covers 192.168.0.0 - 192.168.15.255
      expect(matchIpAddress('192.168.0.1', '192.168.0.0/20')).toBe(true);
      expect(matchIpAddress('192.168.15.255', '192.168.0.0/20')).toBe(true);
      expect(matchIpAddress('192.168.16.0', '192.168.0.0/20')).toBe(false);
    });

    it('should handle /31 point-to-point link', () => {
      expect(matchIpAddress('10.0.0.0', '10.0.0.0/31')).toBe(true);
      expect(matchIpAddress('10.0.0.1', '10.0.0.0/31')).toBe(true);
      expect(matchIpAddress('10.0.0.2', '10.0.0.0/31')).toBe(false);
    });
  });

  // ===========================================================================
  // IPv6 EXACT MATCH
  // ===========================================================================

  describe('IPv6 exact match', () => {
    it('should match identical fully-expanded IPv6 addresses', () => {
      expect(matchIpAddress(
        '2001:0db8:0000:0000:0000:0000:0000:0001',
        '2001:0db8:0000:0000:0000:0000:0000:0001',
      )).toBe(true);
    });

    it('should match IPv6 with :: shorthand (both sides)', () => {
      expect(matchIpAddress('::1', '::1')).toBe(true);
    });

    it('should not match different IPv6 addresses', () => {
      expect(matchIpAddress('::1', '::2')).toBe(false);
    });
  });

  // ===========================================================================
  // IPv6 CIDR
  // ===========================================================================

  describe('IPv6 CIDR notation', () => {
    it('should match IP within /64 subnet', () => {
      expect(matchIpAddress('2001:db8::1', '2001:db8::/64')).toBe(true);
      expect(matchIpAddress('2001:db8::ffff', '2001:db8::/64')).toBe(true);
    });

    it('should not match IP outside /64 subnet', () => {
      expect(matchIpAddress('2001:db9::1', '2001:db8::/64')).toBe(false);
    });

    it('should match within /48 subnet', () => {
      expect(matchIpAddress('2001:db8:abcd::1', '2001:db8:abcd::/48')).toBe(true);
      expect(matchIpAddress('2001:db8:abce::1', '2001:db8:abcd::/48')).toBe(false);
    });

    it('should match link-local fe80::/10 range', () => {
      expect(matchIpAddress('fe80::1', 'fe80::/10')).toBe(true);
      expect(matchIpAddress('febf::1', 'fe80::/10')).toBe(true);
      // fec0 is outside /10
      expect(matchIpAddress('fec0::1', 'fe80::/10')).toBe(false);
    });

    it('should match loopback ::1/128 exactly', () => {
      expect(matchIpAddress('::1', '::1/128')).toBe(true);
      expect(matchIpAddress('::2', '::1/128')).toBe(false);
    });

    it('should treat bare IPv6 address as /128 (exact host)', () => {
      expect(matchIpAddress('::1', '::1')).toBe(true);
      expect(matchIpAddress('::2', '::1')).toBe(false);
    });

    it('should match /0 as any IPv6 address', () => {
      expect(matchIpAddress('2001:db8::1', '::/0')).toBe(true);
      expect(matchIpAddress('fe80::1', '::/0')).toBe(true);
    });
  });

  // ===========================================================================
  // IPv4 / IPv6 FAMILY MISMATCH
  // ===========================================================================

  describe('address family mismatch', () => {
    it('should not match IPv4 against IPv6 pattern', () => {
      expect(matchIpAddress('192.168.1.1', '::1/128')).toBe(false);
    });

    it('should not match IPv6 against IPv4 pattern', () => {
      expect(matchIpAddress('::1', '192.168.1.0/24')).toBe(false);
    });
  });

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('edge cases', () => {
    it('should fall back to string comparison for non-IP patterns', () => {
      // Non-IP patterns should still do exact string match as fallback
      expect(matchIpAddress('some-hostname', 'some-hostname')).toBe(true);
      expect(matchIpAddress('some-hostname', 'other-hostname')).toBe(false);
    });

    it('should handle invalid CIDR prefix gracefully (return false)', () => {
      expect(matchIpAddress('192.168.1.1', '192.168.1.0/33')).toBe(false);
      expect(matchIpAddress('192.168.1.1', '192.168.1.0/-1')).toBe(false);
    });

    it('should handle invalid IPv6 CIDR prefix gracefully (return false)', () => {
      expect(matchIpAddress('::1', '::1/129')).toBe(false);
      expect(matchIpAddress('::1', '::1/-1')).toBe(false);
    });

    it('should handle invalid IPv4 octets gracefully', () => {
      // Falls back to string match — invalid IPs won't parse
      expect(matchIpAddress('999.999.999.999', '192.168.1.0/24')).toBe(false);
    });

    it('should handle common private network ranges', () => {
      // 10.0.0.0/8
      expect(matchIpAddress('10.10.10.10', '10.0.0.0/8')).toBe(true);
      // 172.16.0.0/12
      expect(matchIpAddress('172.16.0.1', '172.16.0.0/12')).toBe(true);
      expect(matchIpAddress('172.31.255.255', '172.16.0.0/12')).toBe(true);
      expect(matchIpAddress('172.32.0.0', '172.16.0.0/12')).toBe(false);
      // 192.168.0.0/16
      expect(matchIpAddress('192.168.100.200', '192.168.0.0/16')).toBe(true);
    });

    it('should handle a /1 prefix for IPv4 (half the address space)', () => {
      // 0.0.0.0/1 covers 0.0.0.0 – 127.255.255.255
      expect(matchIpAddress('127.255.255.255', '0.0.0.0/1')).toBe(true);
      expect(matchIpAddress('128.0.0.0', '0.0.0.0/1')).toBe(false);
    });
  });
});
