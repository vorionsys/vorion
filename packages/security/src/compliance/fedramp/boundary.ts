/**
 * FedRAMP System Boundary Documentation
 *
 * Manages system boundary documentation including:
 * - Component inventory
 * - Data flow diagrams (metadata)
 * - Network diagrams (metadata)
 * - Interconnections tracking
 * - External services documentation
 *
 * @packageDocumentation
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';

const logger = createLogger({ component: 'fedramp-boundary' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Component types within the boundary
 */
export const COMPONENT_TYPES = [
  'server',
  'database',
  'load-balancer',
  'firewall',
  'storage',
  'container',
  'serverless',
  'api-gateway',
  'message-queue',
  'cache',
  'monitoring',
  'logging',
  'identity-provider',
  'dns',
  'cdn',
  'waf',
  'vpn',
  'hsm',
  'secrets-manager',
  'workstation',
  'mobile-device',
  'network-device',
  'other',
] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

/**
 * Component status
 */
export const COMPONENT_STATUSES = [
  'production',
  'development',
  'staging',
  'decommissioned',
  'planned',
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

/**
 * Data classification levels
 */
export const DATA_CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'restricted',
  'cui', // Controlled Unclassified Information
  'pii', // Personally Identifiable Information
  'phi', // Protected Health Information
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

/**
 * Connection type
 */
export const CONNECTION_TYPES = [
  'https',
  'tls',
  'ssh',
  'vpn',
  'direct-connect',
  'ipsec',
  'mtls',
  'api',
  'database',
  'internal',
] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

/**
 * Interconnection type
 */
export const INTERCONNECTION_TYPES = [
  'federal-agency',
  'commercial-csp',
  'third-party-service',
  'partner-organization',
  'customer-system',
] as const;
export type InterconnectionType = (typeof INTERCONNECTION_TYPES)[number];

/**
 * External service type
 */
export const EXTERNAL_SERVICE_TYPES = [
  'saas',
  'paas',
  'iaas',
  'api-service',
  'identity-provider',
  'payment-processor',
  'email-service',
  'monitoring-service',
  'cdn',
  'dns',
  'security-service',
  'other',
] as const;
export type ExternalServiceType = (typeof EXTERNAL_SERVICE_TYPES)[number];

/**
 * System component within the authorization boundary
 */
export interface SystemComponent {
  /** Unique identifier */
  id: string;
  /** Component name */
  name: string;
  /** Component type */
  type: ComponentType;
  /** Description */
  description: string;
  /** Status */
  status: ComponentStatus;
  /** Is this within the authorization boundary */
  withinBoundary: boolean;
  /** IP addresses */
  ipAddresses?: string[];
  /** Hostname/FQDN */
  hostname?: string;
  /** Operating system */
  operatingSystem?: string;
  /** Software/version running on component */
  software?: Array<{
    name: string;
    version: string;
    vendor: string;
    patchLevel?: string;
  }>;
  /** Physical location / data center */
  location: string;
  /** Cloud provider if applicable */
  cloudProvider?: string;
  /** Cloud region if applicable */
  cloudRegion?: string;
  /** Availability zone */
  availabilityZone?: string;
  /** Owner/team responsible */
  owner: string;
  /** Data classifications handled */
  dataClassifications: DataClassification[];
  /** Security controls applied */
  securityControls: string[];
  /** Last scan date */
  lastScanDate?: Date;
  /** Asset tag/identifier */
  assetTag?: string;
  /** Serial number */
  serialNumber?: string;
  /** Purchase date */
  purchaseDate?: Date;
  /** End of life date */
  endOfLifeDate?: Date;
  /** Is virtual/containerized */
  isVirtual: boolean;
  /** Parent component ID if virtualized */
  parentComponentId?: string;
  /** Tags for categorization */
  tags: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export const systemComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(COMPONENT_TYPES),
  description: z.string().min(1),
  status: z.enum(COMPONENT_STATUSES),
  withinBoundary: z.boolean(),
  ipAddresses: z.array(z.string()).optional(),
  hostname: z.string().optional(),
  operatingSystem: z.string().optional(),
  software: z
    .array(
      z.object({
        name: z.string(),
        version: z.string(),
        vendor: z.string(),
        patchLevel: z.string().optional(),
      })
    )
    .optional(),
  location: z.string().min(1),
  cloudProvider: z.string().optional(),
  cloudRegion: z.string().optional(),
  availabilityZone: z.string().optional(),
  owner: z.string().min(1),
  dataClassifications: z.array(z.enum(DATA_CLASSIFICATIONS)),
  securityControls: z.array(z.string()),
  lastScanDate: z.coerce.date().optional(),
  assetTag: z.string().optional(),
  serialNumber: z.string().optional(),
  purchaseDate: z.coerce.date().optional(),
  endOfLifeDate: z.coerce.date().optional(),
  isVirtual: z.boolean(),
  parentComponentId: z.string().optional(),
  tags: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Data flow within the system
 */
export interface DataFlow {
  /** Unique identifier */
  id: string;
  /** Flow name */
  name: string;
  /** Description */
  description: string;
  /** Source component ID */
  sourceComponentId: string;
  /** Destination component ID */
  destinationComponentId: string;
  /** Data types in this flow */
  dataTypes: string[];
  /** Data classifications */
  dataClassifications: DataClassification[];
  /** Connection type */
  connectionType: ConnectionType;
  /** Protocol */
  protocol: string;
  /** Port(s) used */
  ports: number[];
  /** Is encrypted */
  isEncrypted: boolean;
  /** Encryption method */
  encryptionMethod?: string;
  /** Flow direction */
  direction: 'unidirectional' | 'bidirectional';
  /** Is this flow required for operation */
  isRequired: boolean;
  /** Associated controls */
  associatedControls: string[];
  /** Diagram reference */
  diagramReference?: string;
}

export const dataFlowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  sourceComponentId: z.string().min(1),
  destinationComponentId: z.string().min(1),
  dataTypes: z.array(z.string()),
  dataClassifications: z.array(z.enum(DATA_CLASSIFICATIONS)),
  connectionType: z.enum(CONNECTION_TYPES),
  protocol: z.string().min(1),
  ports: z.array(z.number().int().positive()),
  isEncrypted: z.boolean(),
  encryptionMethod: z.string().optional(),
  direction: z.enum(['unidirectional', 'bidirectional']),
  isRequired: z.boolean(),
  associatedControls: z.array(z.string()),
  diagramReference: z.string().optional(),
});

/**
 * Network zone
 */
export interface NetworkZone {
  /** Unique identifier */
  id: string;
  /** Zone name */
  name: string;
  /** Description */
  description: string;
  /** CIDR ranges */
  cidrRanges: string[];
  /** Security level */
  securityLevel: 'dmz' | 'internal' | 'restricted' | 'management';
  /** Component IDs in this zone */
  componentIds: string[];
  /** Allowed inbound connections */
  allowedInbound: Array<{
    fromZone: string;
    ports: number[];
    protocol: string;
  }>;
  /** Allowed outbound connections */
  allowedOutbound: Array<{
    toZone: string;
    ports: number[];
    protocol: string;
  }>;
  /** Firewall rules reference */
  firewallRulesRef?: string;
}

export const networkZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  cidrRanges: z.array(z.string()),
  securityLevel: z.enum(['dmz', 'internal', 'restricted', 'management']),
  componentIds: z.array(z.string()),
  allowedInbound: z.array(
    z.object({
      fromZone: z.string(),
      ports: z.array(z.number()),
      protocol: z.string(),
    })
  ),
  allowedOutbound: z.array(
    z.object({
      toZone: z.string(),
      ports: z.array(z.number()),
      protocol: z.string(),
    })
  ),
  firewallRulesRef: z.string().optional(),
});

/**
 * System interconnection (ISA/MOU)
 */
export interface SystemInterconnection {
  /** Unique identifier */
  id: string;
  /** Interconnection name */
  name: string;
  /** Description */
  description: string;
  /** Type of interconnection */
  type: InterconnectionType;
  /** Remote system name */
  remoteSystemName: string;
  /** Remote organization */
  remoteOrganization: string;
  /** Remote POC */
  remotePoc: {
    name: string;
    email: string;
    phone?: string;
  };
  /** Local POC */
  localPoc: {
    name: string;
    email: string;
    phone?: string;
  };
  /** Connection type */
  connectionType: ConnectionType;
  /** Data shared */
  dataShared: DataClassification[];
  /** Direction of data flow */
  direction: 'inbound' | 'outbound' | 'bidirectional';
  /** Security requirements */
  securityRequirements: string[];
  /** ISA/MOU document reference */
  agreementDocRef?: string;
  /** Agreement effective date */
  agreementEffectiveDate?: Date;
  /** Agreement expiration date */
  agreementExpirationDate?: Date;
  /** Status */
  status: 'proposed' | 'pending-approval' | 'active' | 'suspended' | 'terminated';
  /** Associated controls */
  associatedControls: string[];
  /** Authorization to connect (ATC) reference */
  atcReference?: string;
  /** Last review date */
  lastReviewDate?: Date;
  /** Review frequency */
  reviewFrequency: 'annual' | 'biannual' | 'quarterly';
}

export const systemInterconnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(INTERCONNECTION_TYPES),
  remoteSystemName: z.string().min(1),
  remoteOrganization: z.string().min(1),
  remotePoc: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
  }),
  localPoc: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
  }),
  connectionType: z.enum(CONNECTION_TYPES),
  dataShared: z.array(z.enum(DATA_CLASSIFICATIONS)),
  direction: z.enum(['inbound', 'outbound', 'bidirectional']),
  securityRequirements: z.array(z.string()),
  agreementDocRef: z.string().optional(),
  agreementEffectiveDate: z.coerce.date().optional(),
  agreementExpirationDate: z.coerce.date().optional(),
  status: z.enum(['proposed', 'pending-approval', 'active', 'suspended', 'terminated']),
  associatedControls: z.array(z.string()),
  atcReference: z.string().optional(),
  lastReviewDate: z.coerce.date().optional(),
  reviewFrequency: z.enum(['annual', 'biannual', 'quarterly']),
});

/**
 * External service dependency
 */
export interface ExternalService {
  /** Unique identifier */
  id: string;
  /** Service name */
  name: string;
  /** Service type */
  type: ExternalServiceType;
  /** Provider name */
  provider: string;
  /** Description */
  description: string;
  /** Purpose */
  purpose: string;
  /** Data classifications shared/processed */
  dataClassifications: DataClassification[];
  /** Is FedRAMP authorized */
  isFedRAMPAuthorized: boolean;
  /** FedRAMP package ID if authorized */
  fedrampPackageId?: string;
  /** FedRAMP authorization level */
  fedrampLevel?: 'low' | 'moderate' | 'high' | 'li-saas';
  /** Authorization date */
  authorizationDate?: Date;
  /** Contract reference */
  contractReference?: string;
  /** Connection type */
  connectionType: ConnectionType;
  /** API endpoints */
  apiEndpoints?: string[];
  /** Status */
  status: 'active' | 'pending' | 'deprecated' | 'terminated';
  /** Responsible party */
  responsibleParty: string;
  /** Security review date */
  securityReviewDate?: Date;
  /** Risk assessment reference */
  riskAssessmentRef?: string;
  /** Associated controls */
  associatedControls: string[];
  /** SLA reference */
  slaReference?: string;
  /** Data processing agreement */
  dpaReference?: string;
}

export const externalServiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(EXTERNAL_SERVICE_TYPES),
  provider: z.string().min(1),
  description: z.string().min(1),
  purpose: z.string().min(1),
  dataClassifications: z.array(z.enum(DATA_CLASSIFICATIONS)),
  isFedRAMPAuthorized: z.boolean(),
  fedrampPackageId: z.string().optional(),
  fedrampLevel: z.enum(['low', 'moderate', 'high', 'li-saas']).optional(),
  authorizationDate: z.coerce.date().optional(),
  contractReference: z.string().optional(),
  connectionType: z.enum(CONNECTION_TYPES),
  apiEndpoints: z.array(z.string()).optional(),
  status: z.enum(['active', 'pending', 'deprecated', 'terminated']),
  responsibleParty: z.string().min(1),
  securityReviewDate: z.coerce.date().optional(),
  riskAssessmentRef: z.string().optional(),
  associatedControls: z.array(z.string()),
  slaReference: z.string().optional(),
  dpaReference: z.string().optional(),
});

/**
 * Diagram metadata
 */
export interface DiagramMetadata {
  /** Unique identifier */
  id: string;
  /** Diagram name */
  name: string;
  /** Diagram type */
  type: 'network' | 'data-flow' | 'system-architecture' | 'boundary' | 'deployment';
  /** Description */
  description: string;
  /** Version */
  version: string;
  /** Last updated */
  lastUpdated: Date;
  /** Author */
  author: string;
  /** File reference */
  fileReference: string;
  /** File format */
  fileFormat: 'pdf' | 'png' | 'visio' | 'drawio' | 'lucidchart';
  /** Components depicted */
  componentsDepicted: string[];
  /** Data flows depicted */
  dataFlowsDepicted?: string[];
  /** Review status */
  reviewStatus: 'draft' | 'reviewed' | 'approved';
  /** Reviewed by */
  reviewedBy?: string;
  /** Review date */
  reviewDate?: Date;
}

export const diagramMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['network', 'data-flow', 'system-architecture', 'boundary', 'deployment']),
  description: z.string().min(1),
  version: z.string().min(1),
  lastUpdated: z.coerce.date(),
  author: z.string().min(1),
  fileReference: z.string().min(1),
  fileFormat: z.enum(['pdf', 'png', 'visio', 'drawio', 'lucidchart']),
  componentsDepicted: z.array(z.string()),
  dataFlowsDepicted: z.array(z.string()).optional(),
  reviewStatus: z.enum(['draft', 'reviewed', 'approved']),
  reviewedBy: z.string().optional(),
  reviewDate: z.coerce.date().optional(),
});

/**
 * Boundary configuration
 */
export interface BoundaryConfig {
  /** System name */
  systemName: string;
  /** Organization name */
  organizationName: string;
  /** Boundary description */
  boundaryDescription: string;
  /** Authorization level */
  authorizationLevel: 'low' | 'moderate' | 'high';
  /** Primary data center */
  primaryDataCenter: string;
  /** Disaster recovery site */
  drSite?: string;
}

// =============================================================================
// BOUNDARY SERVICE
// =============================================================================

/**
 * System Boundary Management Service
 */
export class BoundaryService {
  private config: BoundaryConfig;
  private components: Map<string, SystemComponent>;
  private dataFlows: Map<string, DataFlow>;
  private networkZones: Map<string, NetworkZone>;
  private interconnections: Map<string, SystemInterconnection>;
  private externalServices: Map<string, ExternalService>;
  private diagrams: Map<string, DiagramMetadata>;

  constructor(config: BoundaryConfig) {
    this.config = config;
    this.components = new Map();
    this.dataFlows = new Map();
    this.networkZones = new Map();
    this.interconnections = new Map();
    this.externalServices = new Map();
    this.diagrams = new Map();

    logger.info(
      { systemName: config.systemName },
      'Boundary service initialized'
    );
  }

  // ===========================================================================
  // COMPONENT MANAGEMENT
  // ===========================================================================

  /**
   * Add a system component
   */
  addComponent(component: Omit<SystemComponent, 'id'>): SystemComponent {
    const id = `COMP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const newComponent: SystemComponent = { ...component, id };

    systemComponentSchema.parse(newComponent);
    this.components.set(id, newComponent);

    logger.info(
      { componentId: id, name: component.name, type: component.type },
      'Component added to inventory'
    );

    return newComponent;
  }

  /**
   * Update a component
   */
  updateComponent(id: string, updates: Partial<SystemComponent>): SystemComponent {
    const existing = this.components.get(id);
    if (!existing) {
      throw new Error(`Component not found: ${id}`);
    }

    const updated: SystemComponent = { ...existing, ...updates, id };
    systemComponentSchema.parse(updated);
    this.components.set(id, updated);

    logger.info({ componentId: id }, 'Component updated');

    return updated;
  }

  /**
   * Remove a component
   */
  removeComponent(id: string): void {
    if (!this.components.has(id)) {
      throw new Error(`Component not found: ${id}`);
    }

    this.components.delete(id);

    // Remove from network zones
    for (const zone of Array.from(this.networkZones.values())) {
      zone.componentIds = zone.componentIds.filter((cid) => cid !== id);
    }

    // Remove associated data flows
    for (const [flowId, flow] of Array.from(this.dataFlows.entries())) {
      if (flow.sourceComponentId === id || flow.destinationComponentId === id) {
        this.dataFlows.delete(flowId);
      }
    }

    logger.info({ componentId: id }, 'Component removed');
  }

  /**
   * Get component by ID
   */
  getComponent(id: string): SystemComponent | undefined {
    return this.components.get(id);
  }

  /**
   * Get all components
   */
  getAllComponents(filter?: {
    type?: ComponentType;
    status?: ComponentStatus;
    withinBoundary?: boolean;
    dataClassification?: DataClassification;
  }): SystemComponent[] {
    let components = Array.from(this.components.values());

    if (filter?.type) {
      components = components.filter((c) => c.type === filter.type);
    }
    if (filter?.status) {
      components = components.filter((c) => c.status === filter.status);
    }
    if (filter?.withinBoundary !== undefined) {
      components = components.filter((c) => c.withinBoundary === filter.withinBoundary);
    }
    if (filter?.dataClassification) {
      components = components.filter((c) =>
        c.dataClassifications.includes(filter.dataClassification!)
      );
    }

    return components;
  }

  /**
   * Get components within authorization boundary
   */
  getBoundaryComponents(): SystemComponent[] {
    return this.getAllComponents({ withinBoundary: true });
  }

  // ===========================================================================
  // DATA FLOW MANAGEMENT
  // ===========================================================================

  /**
   * Add a data flow
   */
  addDataFlow(flow: Omit<DataFlow, 'id'>): DataFlow {
    // Validate source and destination exist
    if (!this.components.has(flow.sourceComponentId)) {
      throw new Error(`Source component not found: ${flow.sourceComponentId}`);
    }
    if (!this.components.has(flow.destinationComponentId)) {
      throw new Error(`Destination component not found: ${flow.destinationComponentId}`);
    }

    const id = `FLOW-${randomUUID().slice(0, 8).toUpperCase()}`;
    const newFlow: DataFlow = { ...flow, id };

    dataFlowSchema.parse(newFlow);
    this.dataFlows.set(id, newFlow);

    logger.info(
      {
        flowId: id,
        name: flow.name,
        source: flow.sourceComponentId,
        destination: flow.destinationComponentId,
      },
      'Data flow added'
    );

    return newFlow;
  }

  /**
   * Get all data flows
   */
  getAllDataFlows(filter?: {
    sourceComponentId?: string;
    destinationComponentId?: string;
    dataClassification?: DataClassification;
  }): DataFlow[] {
    let flows = Array.from(this.dataFlows.values());

    if (filter?.sourceComponentId) {
      flows = flows.filter((f) => f.sourceComponentId === filter.sourceComponentId);
    }
    if (filter?.destinationComponentId) {
      flows = flows.filter((f) => f.destinationComponentId === filter.destinationComponentId);
    }
    if (filter?.dataClassification) {
      flows = flows.filter((f) =>
        f.dataClassifications.includes(filter.dataClassification!)
      );
    }

    return flows;
  }

  /**
   * Get data flows for a component
   */
  getComponentDataFlows(componentId: string): DataFlow[] {
    return Array.from(this.dataFlows.values()).filter(
      (f) => f.sourceComponentId === componentId || f.destinationComponentId === componentId
    );
  }

  // ===========================================================================
  // NETWORK ZONE MANAGEMENT
  // ===========================================================================

  /**
   * Add a network zone
   */
  addNetworkZone(zone: Omit<NetworkZone, 'id'>): NetworkZone {
    const id = `ZONE-${randomUUID().slice(0, 8).toUpperCase()}`;
    const newZone: NetworkZone = { ...zone, id };

    networkZoneSchema.parse(newZone);
    this.networkZones.set(id, newZone);

    logger.info({ zoneId: id, name: zone.name }, 'Network zone added');

    return newZone;
  }

  /**
   * Get all network zones
   */
  getAllNetworkZones(): NetworkZone[] {
    return Array.from(this.networkZones.values());
  }

  /**
   * Add component to zone
   */
  addComponentToZone(zoneId: string, componentId: string): void {
    const zone = this.networkZones.get(zoneId);
    if (!zone) {
      throw new Error(`Network zone not found: ${zoneId}`);
    }
    if (!this.components.has(componentId)) {
      throw new Error(`Component not found: ${componentId}`);
    }

    if (!zone.componentIds.includes(componentId)) {
      zone.componentIds.push(componentId);
      this.networkZones.set(zoneId, zone);
    }
  }

  // ===========================================================================
  // INTERCONNECTION MANAGEMENT
  // ===========================================================================

  /**
   * Add a system interconnection
   */
  addInterconnection(
    interconnection: Omit<SystemInterconnection, 'id'>
  ): SystemInterconnection {
    const id = `ISA-${randomUUID().slice(0, 8).toUpperCase()}`;
    const newInterconnection: SystemInterconnection = { ...interconnection, id };

    systemInterconnectionSchema.parse(newInterconnection);
    this.interconnections.set(id, newInterconnection);

    logger.info(
      {
        interconnectionId: id,
        name: interconnection.name,
        remoteSystem: interconnection.remoteSystemName,
      },
      'System interconnection added'
    );

    return newInterconnection;
  }

  /**
   * Update interconnection status
   */
  updateInterconnectionStatus(
    id: string,
    status: SystemInterconnection['status']
  ): SystemInterconnection {
    const interconnection = this.interconnections.get(id);
    if (!interconnection) {
      throw new Error(`Interconnection not found: ${id}`);
    }

    interconnection.status = status;
    this.interconnections.set(id, interconnection);

    logger.info({ interconnectionId: id, status }, 'Interconnection status updated');

    return interconnection;
  }

  /**
   * Get all interconnections
   */
  getAllInterconnections(filter?: {
    type?: InterconnectionType;
    status?: SystemInterconnection['status'];
  }): SystemInterconnection[] {
    let interconnections = Array.from(this.interconnections.values());

    if (filter?.type) {
      interconnections = interconnections.filter((i) => i.type === filter.type);
    }
    if (filter?.status) {
      interconnections = interconnections.filter((i) => i.status === filter.status);
    }

    return interconnections;
  }

  /**
   * Get interconnections needing review
   */
  getInterconnectionsNeedingReview(): SystemInterconnection[] {
    const now = new Date();
    return Array.from(this.interconnections.values()).filter((i) => {
      if (!i.lastReviewDate) return true;

      const monthsSinceReview = Math.floor(
        (now.getTime() - i.lastReviewDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
      );

      const reviewPeriods: Record<SystemInterconnection['reviewFrequency'], number> = {
        quarterly: 3,
        biannual: 6,
        annual: 12,
      };

      return monthsSinceReview >= reviewPeriods[i.reviewFrequency];
    });
  }

  /**
   * Get expiring agreements
   */
  getExpiringAgreements(daysThreshold: number = 90): SystemInterconnection[] {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + daysThreshold);

    return Array.from(this.interconnections.values()).filter(
      (i) =>
        i.status === 'active' &&
        i.agreementExpirationDate &&
        i.agreementExpirationDate <= threshold
    );
  }

  // ===========================================================================
  // EXTERNAL SERVICE MANAGEMENT
  // ===========================================================================

  /**
   * Add an external service
   */
  addExternalService(service: Omit<ExternalService, 'id'>): ExternalService {
    const id = `EXT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const newService: ExternalService = { ...service, id };

    externalServiceSchema.parse(newService);
    this.externalServices.set(id, newService);

    logger.info(
      {
        serviceId: id,
        name: service.name,
        provider: service.provider,
        isFedRAMPAuthorized: service.isFedRAMPAuthorized,
      },
      'External service added'
    );

    return newService;
  }

  /**
   * Get all external services
   */
  getAllExternalServices(filter?: {
    type?: ExternalServiceType;
    status?: ExternalService['status'];
    isFedRAMPAuthorized?: boolean;
  }): ExternalService[] {
    let services = Array.from(this.externalServices.values());

    if (filter?.type) {
      services = services.filter((s) => s.type === filter.type);
    }
    if (filter?.status) {
      services = services.filter((s) => s.status === filter.status);
    }
    if (filter?.isFedRAMPAuthorized !== undefined) {
      services = services.filter((s) => s.isFedRAMPAuthorized === filter.isFedRAMPAuthorized);
    }

    return services;
  }

  /**
   * Get non-FedRAMP authorized services (requires risk assessment)
   */
  getNonFedRAMPServices(): ExternalService[] {
    return this.getAllExternalServices({ isFedRAMPAuthorized: false, status: 'active' });
  }

  // ===========================================================================
  // DIAGRAM MANAGEMENT
  // ===========================================================================

  /**
   * Add diagram metadata
   */
  addDiagram(diagram: Omit<DiagramMetadata, 'id'>): DiagramMetadata {
    const id = `DGM-${randomUUID().slice(0, 8).toUpperCase()}`;
    const newDiagram: DiagramMetadata = { ...diagram, id };

    diagramMetadataSchema.parse(newDiagram);
    this.diagrams.set(id, newDiagram);

    logger.info({ diagramId: id, name: diagram.name, type: diagram.type }, 'Diagram added');

    return newDiagram;
  }

  /**
   * Get all diagrams
   */
  getAllDiagrams(filter?: {
    type?: DiagramMetadata['type'];
    reviewStatus?: DiagramMetadata['reviewStatus'];
  }): DiagramMetadata[] {
    let diagrams = Array.from(this.diagrams.values());

    if (filter?.type) {
      diagrams = diagrams.filter((d) => d.type === filter.type);
    }
    if (filter?.reviewStatus) {
      diagrams = diagrams.filter((d) => d.reviewStatus === filter.reviewStatus);
    }

    return diagrams;
  }

  // ===========================================================================
  // REPORTING
  // ===========================================================================

  /**
   * Generate boundary inventory summary
   */
  generateInventorySummary(): BoundaryInventorySummary {
    const components = Array.from(this.components.values());
    const boundaryComponents = components.filter((c) => c.withinBoundary);

    const componentsByType: Record<string, number> = {};
    for (const comp of boundaryComponents) {
      componentsByType[comp.type] = (componentsByType[comp.type] || 0) + 1;
    }

    const componentsByStatus: Record<string, number> = {};
    for (const comp of boundaryComponents) {
      componentsByStatus[comp.status] = (componentsByStatus[comp.status] || 0) + 1;
    }

    const dataClassificationsHandled = new Set<DataClassification>();
    for (const comp of boundaryComponents) {
      for (const dc of comp.dataClassifications) {
        dataClassificationsHandled.add(dc);
      }
    }

    return {
      generatedDate: new Date(),
      systemName: this.config.systemName,
      authorizationLevel: this.config.authorizationLevel,
      totalComponents: components.length,
      boundaryComponents: boundaryComponents.length,
      componentsByType,
      componentsByStatus,
      dataFlowCount: this.dataFlows.size,
      networkZoneCount: this.networkZones.size,
      activeInterconnections: this.getAllInterconnections({ status: 'active' }).length,
      activeExternalServices: this.getAllExternalServices({ status: 'active' }).length,
      nonFedRAMPServices: this.getNonFedRAMPServices().length,
      dataClassificationsHandled: Array.from(dataClassificationsHandled),
      diagramsApproved: this.getAllDiagrams({ reviewStatus: 'approved' }).length,
      interconnectionsNeedingReview: this.getInterconnectionsNeedingReview().length,
      expiringAgreements: this.getExpiringAgreements().length,
    };
  }

  /**
   * Export boundary documentation for SSP
   */
  exportForSSP(): SSPBoundaryDocumentation {
    return {
      systemDescription: {
        systemName: this.config.systemName,
        organizationName: this.config.organizationName,
        boundaryDescription: this.config.boundaryDescription,
        authorizationLevel: this.config.authorizationLevel,
      },
      componentInventory: this.getBoundaryComponents(),
      dataFlows: Array.from(this.dataFlows.values()),
      networkZones: Array.from(this.networkZones.values()),
      interconnections: this.getAllInterconnections({ status: 'active' }),
      externalServices: this.getAllExternalServices({ status: 'active' }),
      diagrams: this.getAllDiagrams({ reviewStatus: 'approved' }),
    };
  }
}

// =============================================================================
// TYPES FOR REPORTS
// =============================================================================

export interface BoundaryInventorySummary {
  generatedDate: Date;
  systemName: string;
  authorizationLevel: 'low' | 'moderate' | 'high';
  totalComponents: number;
  boundaryComponents: number;
  componentsByType: Record<string, number>;
  componentsByStatus: Record<string, number>;
  dataFlowCount: number;
  networkZoneCount: number;
  activeInterconnections: number;
  activeExternalServices: number;
  nonFedRAMPServices: number;
  dataClassificationsHandled: DataClassification[];
  diagramsApproved: number;
  interconnectionsNeedingReview: number;
  expiringAgreements: number;
}

export interface SSPBoundaryDocumentation {
  systemDescription: {
    systemName: string;
    organizationName: string;
    boundaryDescription: string;
    authorizationLevel: 'low' | 'moderate' | 'high';
  };
  componentInventory: SystemComponent[];
  dataFlows: DataFlow[];
  networkZones: NetworkZone[];
  interconnections: SystemInterconnection[];
  externalServices: ExternalService[];
  diagrams: DiagramMetadata[];
}

// =============================================================================
// EXPORTS
// =============================================================================

export default BoundaryService;
