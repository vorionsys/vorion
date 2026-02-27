import { describe, it, expect } from 'vitest';
import { staticLexicon } from './lexicon-data';

describe('staticLexicon', () => {
  it('should have at least 25 terms', () => {
    expect(staticLexicon.length).toBeGreaterThanOrEqual(25);
  });

  it('should have unique slugs for all terms that have them', () => {
    const slugs = staticLexicon
      .map(term => term.slug)
      .filter((slug): slug is string => !!slug);
    const uniqueSlugs = new Set(slugs);
    expect(slugs.length).toBe(uniqueSlugs.size);
  });

  it('should have a term for "Agent"', () => {
    const agent = staticLexicon.find(t => t.term === 'Agent');
    expect(agent).toBeDefined();
    expect(agent?.slug).toBe('agent');
  });

  it('should have correct categories', () => {
    const validCategories = [
      'core', 'architecture', 'protocols', 'orchestration', 'safety', 
      'techniques', 'evolution', 'prompting', 'frameworks', 'evaluation', 
      'enterprise', 'ethics', 'ml-fundamentals', 'nlp', 'infrastructure', 'governance'
    ];
    
    staticLexicon.forEach(term => {
      expect(validCategories).toContain(term.category);
    });
  });
});
