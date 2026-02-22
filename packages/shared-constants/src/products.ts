/**
 * @vorionsys/shared-constants - Product Definitions
 *
 * Single source of truth for all Vorion ecosystem products
 * Used for consistent product references across all sites
 *
 * @see https://vorion.org
 */

// =============================================================================
// PRODUCT CATEGORIES
// =============================================================================

export enum ProductCategory {
  /** Open source standards and specifications */
  OPEN_SOURCE = 'open_source',

  /** Commercial SaaS products */
  COMMERCIAL = 'commercial',

  /** Developer tools and SDKs */
  DEVELOPER_TOOLS = 'developer_tools',

  /** Educational platforms */
  EDUCATION = 'education',
}

// =============================================================================
// PRODUCT STATUS
// =============================================================================

export enum ProductStatus {
  /** In active development, not yet released */
  DEVELOPMENT = 'development',

  /** Released as alpha/preview */
  ALPHA = 'alpha',

  /** Released as beta */
  BETA = 'beta',

  /** Generally available */
  GA = 'ga',

  /** Deprecated, still supported */
  DEPRECATED = 'deprecated',

  /** End of life, no longer supported */
  EOL = 'eol',
}

// =============================================================================
// PRODUCT DEFINITIONS
// =============================================================================

export interface ProductDefinition {
  /** Unique product identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Short description */
  description: string;

  /** Product category */
  category: ProductCategory;

  /** Current status */
  status: ProductStatus;

  /** Primary website URL */
  url: string;

  /** Documentation URL */
  docsUrl?: string;

  /** GitHub repository URL */
  repoUrl?: string;

  /** NPM package name */
  npmPackage?: string;

  /** Parent organization */
  organization: 'vorion';

  /** Version (semver) */
  version?: string;
}

// =============================================================================
// VORION OPEN SOURCE PRODUCTS
// =============================================================================

export const VORION_PRODUCTS: Record<string, ProductDefinition> = {
  basis: {
    id: 'basis',
    name: 'BASIS',
    description: 'Blockchain Agent Safety & Identity Standard - Open framework for AI agent governance',
    category: ProductCategory.OPEN_SOURCE,
    status: ProductStatus.GA,
    url: 'https://basis.vorion.org',
    docsUrl: 'https://basis.vorion.org/docs',
    repoUrl: 'https://github.com/vorionsys/vorion/tree/master/packages/basis',
    npmPackage: '@vorionsys/basis',
    organization: 'vorion',
    version: '1.0.0',
  },

  carId: {
    id: 'car-id',
    name: 'CAR ID',
    description: 'Categorical Agentic Registry - Universal agent identification system',
    category: ProductCategory.OPEN_SOURCE,
    status: ProductStatus.GA,
    url: 'https://carid.vorion.org',
    docsUrl: 'https://carid.vorion.org/docs',
    repoUrl: 'https://github.com/vorionsys/vorion/tree/master/packages/car-spec',
    npmPackage: '@vorionsys/car-spec',
    organization: 'vorion',
    version: '1.0.0',
  },

  atsf: {
    id: 'atsf',
    name: 'ATSF',
    description: 'Agent Trust & Safety Framework - Comprehensive safety evaluation system',
    category: ProductCategory.OPEN_SOURCE,
    status: ProductStatus.BETA,
    url: 'https://atsf.vorion.org',
    docsUrl: 'https://atsf.vorion.org/docs',
    repoUrl: 'https://github.com/vorionsys/vorion/tree/master/packages/atsf-core',
    npmPackage: '@vorionsys/atsf-core',
    organization: 'vorion',
    version: '0.9.0',
  },

  kaizen: {
    id: 'kaizen',
    name: 'Kaizen',
    description: 'Interactive AI Learning Experience - Educational platform for agentic AI',
    category: ProductCategory.EDUCATION,
    status: ProductStatus.BETA,
    url: 'https://learn.vorion.org',
    docsUrl: 'https://learn.vorion.org/docs',
    repoUrl: 'https://github.com/vorionsys/vorion/tree/master/kaizen',
    organization: 'vorion',
  },

  kaizenStudio: {
    id: 'kaizen-studio',
    name: 'Kaizen Studio',
    description: 'Interactive AI learning studio - hands-on agentic AI experiments',
    category: ProductCategory.EDUCATION,
    status: ProductStatus.BETA,
    url: 'https://kaizen.vorion.org',
    repoUrl: 'https://github.com/vorionsys/vorion/tree/master/kaizen',
    organization: 'vorion',
  },

  proofPlane: {
    id: 'proof-plane',
    name: 'Proof Plane',
    description: 'Cryptographic proof layer for agent attestations and verifiable execution',
    category: ProductCategory.OPEN_SOURCE,
    status: ProductStatus.BETA,
    url: 'https://vorion.org/proof-plane',
    repoUrl: 'https://github.com/vorionsys/vorion/tree/master/packages/proof-plane',
    npmPackage: '@vorionsys/proof-plane',
    organization: 'vorion',
    version: '0.5.0',
  },

  contracts: {
    id: 'contracts',
    name: 'Vorion Contracts',
    description: 'Smart contracts for on-chain agent governance and attestations',
    category: ProductCategory.OPEN_SOURCE,
    status: ProductStatus.BETA,
    url: 'https://vorion.org/contracts',
    repoUrl: 'https://github.com/vorionsys/vorion/tree/master/packages/contracts',
    npmPackage: '@vorionsys/contracts',
    organization: 'vorion',
  },
} as const;

// =============================================================================
// VORION COMMERCIAL PRODUCTS
// =============================================================================

export const AGENTANCHOR_PRODUCTS: Record<string, ProductDefinition> = {
  cognigate: {
    id: 'cognigate',
    name: 'Cognigate',
    description: 'AI Governance API - Reference implementation of BASIS runtime',
    category: ProductCategory.COMMERCIAL,
    status: ProductStatus.GA,
    url: 'https://cognigate.dev',
    docsUrl: 'https://cognigate.dev/docs',
    npmPackage: '@vorionsys/cognigate',
    organization: 'vorion',
    version: '1.0.0',
  },

  trust: {
    id: 'trust',
    name: 'Vorion Trust',
    description: 'Trust verification and certification platform for AI agents',
    category: ProductCategory.COMMERCIAL,
    status: ProductStatus.GA,
    url: 'https://trust.vorion.org',
    docsUrl: 'https://trust.vorion.org/docs',
    organization: 'vorion',
  },

  logic: {
    id: 'logic',
    name: 'Vorion Logic',
    description: 'Policy engine and governance logic for enterprise AI',
    category: ProductCategory.COMMERCIAL,
    status: ProductStatus.BETA,
    url: 'https://logic.vorion.org',
    docsUrl: 'https://logic.vorion.org/docs',
    organization: 'vorion',
  },

  platform: {
    id: 'platform',
    name: 'Vorion Platform',
    description: 'Enterprise AI governance dashboard and management console',
    category: ProductCategory.COMMERCIAL,
    status: ProductStatus.GA,
    url: 'https://vorion.org',
    docsUrl: 'https://vorion.org/docs',
    organization: 'vorion',
  },
} as const;

// =============================================================================
// ALL PRODUCTS
// =============================================================================

export const ALL_PRODUCTS = {
  vorion: VORION_PRODUCTS,
  agentAnchor: AGENTANCHOR_PRODUCTS,
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get a product by its ID
 */
export function getProduct(productId: string): ProductDefinition | undefined {
  return (
    VORION_PRODUCTS[productId] ||
    AGENTANCHOR_PRODUCTS[productId]
  );
}

/**
 * Get all products by category
 */
export function getProductsByCategory(category: ProductCategory): ProductDefinition[] {
  const allProducts = [...Object.values(VORION_PRODUCTS), ...Object.values(AGENTANCHOR_PRODUCTS)];
  return allProducts.filter(p => p.category === category);
}

/**
 * Get all products by status
 */
export function getProductsByStatus(status: ProductStatus): ProductDefinition[] {
  const allProducts = [...Object.values(VORION_PRODUCTS), ...Object.values(AGENTANCHOR_PRODUCTS)];
  return allProducts.filter(p => p.status === status);
}

/**
 * Get all products by organization
 */
export function getProductsByOrganization(org: 'vorion'): ProductDefinition[] {
  return org === 'vorion'
    ? Object.values(VORION_PRODUCTS)
    : Object.values(AGENTANCHOR_PRODUCTS);
}
