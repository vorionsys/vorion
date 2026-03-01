import { describe, it, expect } from 'vitest';
import {
  ProductCategory,
  ProductStatus,
  VORION_PRODUCTS,
  AGENTANCHOR_PRODUCTS,
  ALL_PRODUCTS,
  getProduct,
  getProductsByCategory,
  getProductsByStatus,
  getProductsByOrganization,
} from './products.js';

describe('VORION_PRODUCTS', () => {
  it('all products are vorion organization', () => {
    for (const product of Object.values(VORION_PRODUCTS)) {
      expect(product.organization).toBe('vorion');
    }
  });

  it('all products have required fields', () => {
    for (const product of Object.values(VORION_PRODUCTS)) {
      expect(product.id).toBeTruthy();
      expect(product.name).toBeTruthy();
      expect(product.description).toBeTruthy();
      expect(Object.values(ProductCategory)).toContain(product.category);
      expect(Object.values(ProductStatus)).toContain(product.status);
      expect(product.url).toMatch(/^https:\/\//);
    }
  });

  it('has unique product IDs', () => {
    const ids = Object.values(VORION_PRODUCTS).map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('AGENTANCHOR_PRODUCTS', () => {
  it('all products are agentanchor organization', () => {
    for (const product of Object.values(AGENTANCHOR_PRODUCTS)) {
      expect(product.organization).toBe('agentanchor');
    }
  });

  it('contains cognigate', () => {
    expect(AGENTANCHOR_PRODUCTS.cognigate).toBeDefined();
    expect(AGENTANCHOR_PRODUCTS.cognigate.name).toBe('Cognigate');
  });
});

describe('ALL_PRODUCTS', () => {
  it('has both organizations', () => {
    expect(ALL_PRODUCTS.vorion).toBe(VORION_PRODUCTS);
    expect(ALL_PRODUCTS.agentAnchor).toBe(AGENTANCHOR_PRODUCTS);
  });
});

describe('getProduct', () => {
  it('finds vorion products by key', () => {
    const basis = getProduct('basis');
    expect(basis).toBeDefined();
    expect(basis!.name).toBe('BASIS');
  });

  it('finds agentanchor products by key', () => {
    const cognigate = getProduct('cognigate');
    expect(cognigate).toBeDefined();
    expect(cognigate!.name).toBe('Cognigate');
  });

  it('returns undefined for unknown product', () => {
    expect(getProduct('nonexistent')).toBeUndefined();
  });
});

describe('getProductsByCategory', () => {
  it('returns open source products', () => {
    const products = getProductsByCategory(ProductCategory.OPEN_SOURCE);
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect(p.category).toBe(ProductCategory.OPEN_SOURCE);
    }
  });

  it('returns commercial products', () => {
    const products = getProductsByCategory(ProductCategory.COMMERCIAL);
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect(p.category).toBe(ProductCategory.COMMERCIAL);
    }
  });
});

describe('getProductsByStatus', () => {
  it('returns GA products', () => {
    const products = getProductsByStatus(ProductStatus.GA);
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect(p.status).toBe(ProductStatus.GA);
    }
  });
});

describe('getProductsByOrganization', () => {
  it('returns vorion products', () => {
    const products = getProductsByOrganization('vorion');
    expect(products.length).toBe(Object.keys(VORION_PRODUCTS).length);
  });

  it('returns agentanchor products', () => {
    const products = getProductsByOrganization('agentanchor');
    expect(products.length).toBe(Object.keys(AGENTANCHOR_PRODUCTS).length);
  });
});
