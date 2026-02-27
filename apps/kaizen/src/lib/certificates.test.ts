import { describe, it, expect } from 'vitest';
import { getAllCertificatesForPath, checkCertificateEligibility } from './certificates';

describe('certificates', () => {
  describe('getAllCertificatesForPath', () => {
    it('should return certificates for a valid path', () => {
      const certs = getAllCertificatesForPath('ai-foundations');
      expect(certs.length).toBeGreaterThan(0);
      expect(certs[0].level).toBe('foundation');
    });

    it('should return empty array for invalid path', () => {
      expect(getAllCertificatesForPath('non-existent')).toEqual([]);
    });
  });

  describe('checkCertificateEligibility', () => {
    it('should award foundation cert for 75% score and 50% modules', () => {
      const result = checkCertificateEligibility('ai-foundations', 75, 55, 0); // 55% modules
      expect(result.eligible).toBe(true);
      expect(result.level).toBe('foundation');
    });

    it('should award master cert for 98% score and 100% modules', () => {
      const result = checkCertificateEligibility('ai-foundations', 98, 100, 100);
      expect(result.eligible).toBe(true);
      expect(result.level).toBe('master');
    });

    it('should not award cert for low score', () => {
      const result = checkCertificateEligibility('ai-foundations', 60, 100, 100);
      expect(result.eligible).toBe(false);
      expect(result.level).toBeNull();
    });
  });
});
