import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadProgress, saveProgress } from './progress';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    clear: () => { store = {}; },
    removeItem: (key: string) => { delete store[key]; },
    length: 0,
    key: (index: number) => Object.keys(store)[index] || null
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('progress', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('loadProgress', () => {
    it('should return default progress if none exists', () => {
      const progress = loadProgress();
      expect(progress.version).toBe(1);
      expect(progress.terms).toEqual({});
    });

    it('should load saved progress', () => {
      const initialProgress = loadProgress();
      initialProgress.terms['agent'] = {
        firstViewed: new Date().toISOString(),
        lastViewed: new Date().toISOString(),
        viewCount: 1,
        mastered: false
      };
      
      saveProgress(initialProgress);
      
      const loadedProgress = loadProgress();
      expect(loadedProgress.terms['agent']).toBeDefined();
      expect(loadedProgress.terms['agent'].viewCount).toBe(1);
    });
  });
});
