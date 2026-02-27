import { describe, it, expect, vi } from 'vitest';
import { cn, formatDate, generateId, debounce, sanitizeHtml } from './utils';

describe('utils', () => {
  describe('cn', () => {
    it('should merge tailwind classes', () => {
      expect(cn('bg-red-500', 'p-4')).toBe('bg-red-500 p-4');
      expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
    });
  });

  describe('formatDate', () => {
    it('should format date correctly', () => {
      const date = new Date('2026-02-26');
      expect(formatDate(date)).toContain('2026');
    });
  });

  describe('generateId', () => {
    it('should generate a string id', () => {
      const id = generateId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(5);
    });
  });

  describe('debounce', () => {
    it('should debounce calls', () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      
      debounced();
      debounced();
      debounced();
      
      expect(fn).not.toHaveBeenCalled();
      
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  describe('sanitizeHtml', () => {
    it('should remove scripts', () => {
      const html = '<div>Safe</div><script>alert("evil")</script>';
      expect(sanitizeHtml(html)).toBe('<div>Safe</div>');
    });

    it('should remove event handlers', () => {
      const html = '<button onclick="alert(1)">Click</button>';
      expect(sanitizeHtml(html)).toBe('<button >Click</button>');
    });
  });
});
