/**
 * FedRAMP System Security Plan (SSP) Generator
 *
 * Automates SSP generation including:
 * - Control implementation descriptions
 * - Responsible roles
 * - Implementation status
 * - Export to FedRAMP template format
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import type { FedRAMPControl, ControlOrigination, ControlResponsibility } from './controls.js';
import type { SystemComponent, DataFlow, SystemInterconnection, ExternalService, NetworkZone } from './boundary.js';
import type { ImplementationStatus } from '../types.js';

const logger = createLogger({ component: 'fedramp-ssp-generator' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * SSP section types
 */
export const SSP_SECTIONS = [
  'system-information',
  'system-environment',
  'system-description',
  'data-flow',
  'ports-protocols-services',
  'interconnections',
  'laws-regulations',
  'control-summary',
  'control-implementation',
] as const;
export type SSPSection = (typeof SSP_SECTIONS)[number];

/**
 * System information for SSP
 */
export interface SystemInformation {
  /** System name */
  systemName: string;
  /** System identifier */
  systemIdentifier: string;
  /** System type */
  systemType: 'major-application' | 'general-support-system';
  /** System categorization */
  securityCategorization: 'low' | 'moderate' | 'high';
  /** Organization name */
  organizationName: string;
  /** System owner */
  systemOwner: {
    name: string;
    title: string;
    organization: string;
    email: string;
    phone: string;
  };
  /** Authorizing official */
  authorizingOfficial: {
    name: string;
    title: string;
    organization: string;
    email: string;
    phone: string;
  };
  /** ISSO */
  isso: {
    name: string;
    title: string;
    organization: string;
    email: string;
    phone: string;
  };
  /** System description */
  systemDescription: string;
  /** System purpose */
  systemPurpose: string;
  /** System function */
  systemFunction: string;
  /** Authorization date */
  authorizationDate?: Date;
  /** Authorization expiration */
  authorizationExpiration?: Date;
  /** FedRAMP authorization type */
  authorizationType: 'agency' | 'jab';
  /** Leveraged authorizations */
  leveragedAuthorizations?: Array<{
    systemName: string;
    serviceProvider: string;
    fedrampPackageId: string;
    authorizationDate: Date;
    servicesUsed: string[];
  }>;
}

/**
 * User type for SSP
 */
export interface SSPUserType {
  /** User type name */
  name: string;
  /** Description */
  description: string;
  /** Privilege level */
  privilegeLevel: 'privileged' | 'non-privileged';
  /** Sensitivity level */
  sensitivityLevel: 'public-trust' | 'moderate-risk' | 'high-risk' | 'national-security';
  /** Authorization required */
  authorizationRequired: string;
  /** MFA required */
  mfaRequired: boolean;
  /** Internal/external */
  userLocation: 'internal' | 'external' | 'both';
}

/**
 * Control implementation statement
 */
export interface ControlImplementationStatement {
  /** Control ID */
  controlId: string;
  /** Control name */
  controlName: string;
  /** Implementation status */
  implementationStatus: ImplementationStatus;
  /** Control origination */
  origination: ControlOrigination;
  /** Responsible roles */
  responsibleRoles: string[];
  /** Implementation description (main narrative) */
  implementationDescription: string;
  /** Implementation parts (for multi-part controls) */
  implementationParts?: Array<{
    partId: string;
    description: string;
  }>;
  /** Parameter values */
  parameters?: Array<{
    parameterId: string;
    value: string;
  }>;
  /** Customer responsibility statement (if applicable) */
  customerResponsibilityStatement?: string;
  /** Related documents */
  relatedDocuments?: string[];
  /** Control enhancements */
  enhancements?: Array<{
    enhancementId: string;
    implementationDescription: string;
    implementationStatus: ImplementationStatus;
  }>;
}

/**
 * SSP export format
 */
export const EXPORT_FORMATS = ['json', 'xml', 'docx', 'oscal'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * SSP generation configuration
 */
export interface SSPGeneratorConfig {
  /** Template version */
  templateVersion: string;
  /** Include appendices */
  includeAppendices: boolean;
  /** Include diagrams metadata */
  includeDiagrams: boolean;
  /** Default export format */
  defaultExportFormat: ExportFormat;
}

/**
 * Complete SSP document
 */
export interface SystemSecurityPlan {
  /** SSP metadata */
  metadata: {
    version: string;
    generatedDate: Date;
    lastModified: Date;
    preparedBy: string;
    templateVersion: string;
  };
  /** System information */
  systemInformation: SystemInformation;
  /** User types */
  userTypes: SSPUserType[];
  /** System environment */
  systemEnvironment: {
    components: SystemComponent[];
    networkZones: NetworkZone[];
    dataFlows: DataFlow[];
    interconnections: SystemInterconnection[];
    externalServices: ExternalService[];
  };
  /** Ports, protocols, and services */
  portsProtocolsServices: Array<{
    port: number;
    protocol: string;
    service: string;
    purpose: string;
    usedBy: string[];
  }>;
  /** Control implementation statements */
  controlImplementations: ControlImplementationStatement[];
  /** Control summary */
  controlSummary: {
    totalControls: number;
    implemented: number;
    partiallyImplemented: number;
    planned: number;
    notApplicable: number;
    byFamily: Array<{
      family: string;
      total: number;
      implemented: number;
    }>;
  };
  /** Applicable laws and regulations */
  lawsAndRegulations: string[];
  /** Attachments/appendices references */
  attachments: Array<{
    name: string;
    description: string;
    reference: string;
  }>;
}

// =============================================================================
// SSP GENERATOR SERVICE
// =============================================================================

/**
 * FedRAMP SSP Generator Service
 */
export class SSPGeneratorService {
  private config: SSPGeneratorConfig;

  constructor(config: SSPGeneratorConfig) {
    this.config = config;

    logger.info('SSP Generator service initialized');
  }

  // ===========================================================================
  // SSP GENERATION
  // ===========================================================================

  /**
   * Generate complete SSP document
   */
  generateSSP(
    systemInfo: SystemInformation,
    controls: FedRAMPControl[],
    components: SystemComponent[],
    networkZones: NetworkZone[],
    dataFlows: DataFlow[],
    interconnections: SystemInterconnection[],
    externalServices: ExternalService[],
    userTypes: SSPUserType[],
    preparedBy: string
  ): SystemSecurityPlan {
    logger.info({ systemName: systemInfo.systemName }, 'Generating SSP');

    // Generate control implementation statements
    const controlImplementations = controls.map((control) =>
      this.generateControlStatement(control)
    );

    // Calculate control summary
    const controlSummary = this.calculateControlSummary(controls);

    // Extract ports, protocols, services from data flows
    const portsProtocolsServices = this.extractPortsProtocolsServices(dataFlows);

    // Default laws and regulations for FedRAMP
    const lawsAndRegulations = this.getDefaultLawsAndRegulations(systemInfo.securityCategorization);

    // Generate attachments list
    const attachments = this.generateAttachmentsList();

    const ssp: SystemSecurityPlan = {
      metadata: {
        version: '1.0',
        generatedDate: new Date(),
        lastModified: new Date(),
        preparedBy,
        templateVersion: this.config.templateVersion,
      },
      systemInformation: systemInfo,
      userTypes,
      systemEnvironment: {
        components,
        networkZones,
        dataFlows,
        interconnections,
        externalServices,
      },
      portsProtocolsServices,
      controlImplementations,
      controlSummary,
      lawsAndRegulations,
      attachments,
    };

    logger.info(
      {
        systemName: systemInfo.systemName,
        totalControls: controls.length,
        implementedControls: controlSummary.implemented,
      },
      'SSP generated successfully'
    );

    return ssp;
  }

  /**
   * Generate control implementation statement
   */
  generateControlStatement(control: FedRAMPControl): ControlImplementationStatement {
    const statement: ControlImplementationStatement = {
      controlId: control.id,
      controlName: control.name,
      implementationStatus: control.implementation,
      origination: control.origination,
      responsibleRoles: control.responsibleRoles,
      implementationDescription: control.implementationDescription,
    };

    // Add parameters if present
    if (control.parameters && control.parameters.length > 0) {
      statement.parameters = control.parameters.map((p) => ({
        parameterId: p.id,
        value: p.value,
      }));
    }

    // Add enhancements if implemented
    if (control.enhancementsImplemented && control.enhancementsImplemented.length > 0) {
      statement.enhancements = control.enhancementsImplemented.map((enhId) => ({
        enhancementId: enhId,
        implementationDescription: `${enhId} is implemented as part of the ${control.id} implementation.`,
        implementationStatus: 'implemented' as ImplementationStatus,
      }));
    }

    // Add customer responsibility if shared
    if (control.responsibility === 'shared' || control.responsibility === 'customer-inherited') {
      statement.customerResponsibilityStatement = this.generateCustomerResponsibility(control);
    }

    return statement;
  }

  /**
   * Generate customer responsibility statement
   */
  private generateCustomerResponsibility(control: FedRAMPControl): string {
    const templates: Record<string, string> = {
      'AC-2': 'Customer is responsible for managing user accounts within their organizational boundary, including provisioning, deprovisioning, and periodic access reviews.',
      'AC-3': 'Customer is responsible for defining and implementing access control policies for their data and applications.',
      'IA-2': 'Customer is responsible for ensuring their users comply with authentication requirements.',
      'IA-5': 'Customer is responsible for managing their user credentials and ensuring compliance with password policies.',
      'AU-6': 'Customer is responsible for reviewing audit logs relevant to their usage of the system.',
    };

    return templates[control.id] ||
      `Customer is responsible for implementing ${control.name} controls within their organizational boundary as applicable.`;
  }

  /**
   * Calculate control summary statistics
   */
  private calculateControlSummary(controls: FedRAMPControl[]): SystemSecurityPlan['controlSummary'] {
    const byFamily = new Map<string, { total: number; implemented: number }>();

    for (const control of controls) {
      const family = control.family;
      const existing = byFamily.get(family) || { total: 0, implemented: 0 };
      existing.total++;
      if (control.implementation === 'implemented') {
        existing.implemented++;
      }
      byFamily.set(family, existing);
    }

    return {
      totalControls: controls.length,
      implemented: controls.filter((c) => c.implementation === 'implemented').length,
      partiallyImplemented: controls.filter((c) => c.implementation === 'partially-implemented').length,
      planned: controls.filter((c) => c.implementation === 'planned').length,
      notApplicable: controls.filter((c) => c.implementation === 'not-applicable').length,
      byFamily: Array.from(byFamily.entries()).map(([family, stats]) => ({
        family,
        total: stats.total,
        implemented: stats.implemented,
      })),
    };
  }

  /**
   * Extract ports, protocols, and services from data flows
   */
  private extractPortsProtocolsServices(
    dataFlows: DataFlow[]
  ): SystemSecurityPlan['portsProtocolsServices'] {
    const ppsMap = new Map<string, SystemSecurityPlan['portsProtocolsServices'][0]>();

    for (const flow of dataFlows) {
      for (const port of flow.ports) {
        const key = `${port}-${flow.protocol}`;
        const existing = ppsMap.get(key);

        if (existing) {
          if (!existing.usedBy.includes(flow.name)) {
            existing.usedBy.push(flow.name);
          }
        } else {
          ppsMap.set(key, {
            port,
            protocol: flow.protocol,
            service: this.inferServiceFromPort(port, flow.protocol),
            purpose: flow.description,
            usedBy: [flow.name],
          });
        }
      }
    }

    return Array.from(ppsMap.values()).sort((a, b) => a.port - b.port);
  }

  /**
   * Infer service name from port number
   */
  private inferServiceFromPort(port: number, protocol: string): string {
    const wellKnownPorts: Record<number, string> = {
      22: 'SSH',
      80: 'HTTP',
      443: 'HTTPS',
      3306: 'MySQL',
      5432: 'PostgreSQL',
      6379: 'Redis',
      27017: 'MongoDB',
      8080: 'HTTP Proxy',
      8443: 'HTTPS Alt',
      9090: 'Prometheus',
      9200: 'Elasticsearch',
      5601: 'Kibana',
    };

    return wellKnownPorts[port] || `Custom Service (${protocol}/${port})`;
  }

  /**
   * Get default applicable laws and regulations
   */
  private getDefaultLawsAndRegulations(level: 'low' | 'moderate' | 'high'): string[] {
    const common = [
      'Federal Information Security Modernization Act (FISMA) of 2014',
      'Privacy Act of 1974',
      'E-Government Act of 2002',
      'OMB Circular A-130',
      'NIST Special Publication 800-53 Rev 5',
      'NIST Special Publication 800-37 Rev 2',
      'FedRAMP Authorization Act',
    ];

    if (level === 'high') {
      common.push('NIST Special Publication 800-171');
      common.push('DFARS 252.204-7012 (if applicable)');
    }

    return common;
  }

  /**
   * Generate standard attachments list
   */
  private generateAttachmentsList(): SystemSecurityPlan['attachments'] {
    return [
      {
        name: 'Attachment A - FedRAMP Moderate Security Controls',
        description: 'Complete listing of FedRAMP Moderate baseline security controls',
        reference: 'FedRAMP-SSP-Attachment-A',
      },
      {
        name: 'Attachment B - Control Implementation Summary',
        description: 'Summary of control implementation status by family',
        reference: 'FedRAMP-SSP-Attachment-B',
      },
      {
        name: 'Attachment C - Policies and Procedures',
        description: 'Reference to organizational security policies and procedures',
        reference: 'FedRAMP-SSP-Attachment-C',
      },
      {
        name: 'Attachment D - Continuous Monitoring Plan',
        description: 'FedRAMP Continuous Monitoring Strategy and Plan',
        reference: 'FedRAMP-SSP-Attachment-D',
      },
      {
        name: 'Attachment E - Incident Response Plan',
        description: 'Security Incident Response procedures',
        reference: 'FedRAMP-SSP-Attachment-E',
      },
      {
        name: 'Attachment F - Configuration Management Plan',
        description: 'Configuration management policies and procedures',
        reference: 'FedRAMP-SSP-Attachment-F',
      },
      {
        name: 'Attachment G - Contingency Plan',
        description: 'IT Contingency Plan and Disaster Recovery procedures',
        reference: 'FedRAMP-SSP-Attachment-G',
      },
      {
        name: 'Attachment H - Rules of Behavior',
        description: 'User rules of behavior and acceptable use policy',
        reference: 'FedRAMP-SSP-Attachment-H',
      },
      {
        name: 'Attachment I - Information System Contingency Plan',
        description: 'ISCP test results and documentation',
        reference: 'FedRAMP-SSP-Attachment-I',
      },
      {
        name: 'Attachment J - User Guide',
        description: 'System user guide documentation',
        reference: 'FedRAMP-SSP-Attachment-J',
      },
      {
        name: 'Attachment K - Digital Identity Worksheet',
        description: 'Digital Identity Risk Assessment',
        reference: 'FedRAMP-SSP-Attachment-K',
      },
      {
        name: 'Attachment L - Privacy Impact Assessment',
        description: 'PIA documentation (if applicable)',
        reference: 'FedRAMP-SSP-Attachment-L',
      },
    ];
  }

  // ===========================================================================
  // EXPORT FUNCTIONS
  // ===========================================================================

  /**
   * Export SSP to JSON format
   */
  exportToJSON(ssp: SystemSecurityPlan): string {
    return JSON.stringify(ssp, (key, value) => {
      // Convert dates to ISO strings
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    }, 2);
  }

  /**
   * Export SSP to OSCAL JSON format
   */
  exportToOSCAL(ssp: SystemSecurityPlan): OSCALSystemSecurityPlan {
    return {
      'system-security-plan': {
        uuid: this.generateUUID(),
        metadata: {
          title: `${ssp.systemInformation.systemName} System Security Plan`,
          'last-modified': ssp.metadata.lastModified.toISOString(),
          version: ssp.metadata.version,
          'oscal-version': '1.0.4',
          roles: this.extractRoles(ssp),
          parties: this.extractParties(ssp),
        },
        'import-profile': {
          href: this.getProfileHref(ssp.systemInformation.securityCategorization),
        },
        'system-characteristics': {
          'system-name': ssp.systemInformation.systemName,
          description: ssp.systemInformation.systemDescription,
          'system-ids': [
            {
              'identifier-type': 'https://fedramp.gov',
              id: ssp.systemInformation.systemIdentifier,
            },
          ],
          'security-sensitivity-level': ssp.systemInformation.securityCategorization,
          'system-information': {
            'information-types': [
              {
                title: 'System Information',
                description: ssp.systemInformation.systemPurpose,
                'categorizations': [
                  {
                    system: 'https://doi.org/10.6028/NIST.SP.800-60v2r1',
                    'information-type-ids': ['C.2.8.12'],
                  },
                ],
              },
            ],
          },
          'authorization-boundary': {
            description: `Authorization boundary for ${ssp.systemInformation.systemName}`,
          },
        },
        'system-implementation': {
          users: ssp.userTypes.map((ut) => ({
            uuid: this.generateUUID(),
            title: ut.name,
            description: ut.description,
            'role-ids': [ut.privilegeLevel],
          })),
          components: ssp.systemEnvironment.components.map((comp) => ({
            uuid: this.generateUUID(),
            type: comp.type,
            title: comp.name,
            description: comp.description,
            status: {
              state: comp.status === 'production' ? 'operational' : comp.status,
            },
          })),
        },
        'control-implementation': {
          description: 'Control implementation for FedRAMP authorization',
          'implemented-requirements': ssp.controlImplementations.map((impl) => ({
            uuid: this.generateUUID(),
            'control-id': impl.controlId.toLowerCase(),
            statements: [
              {
                'statement-id': `${impl.controlId.toLowerCase()}_smt`,
                uuid: this.generateUUID(),
                description: impl.implementationDescription,
              },
            ],
          })),
        },
      },
    };
  }

  /**
   * Export control implementation section
   */
  exportControlImplementationSection(ssp: SystemSecurityPlan): string {
    let output = `# Control Implementation Statements\n\n`;
    output += `System: ${ssp.systemInformation.systemName}\n`;
    output += `Security Categorization: ${ssp.systemInformation.securityCategorization.toUpperCase()}\n`;
    output += `Generated: ${ssp.metadata.generatedDate.toISOString()}\n\n`;

    output += `## Summary\n\n`;
    output += `| Status | Count |\n`;
    output += `|--------|-------|\n`;
    output += `| Implemented | ${ssp.controlSummary.implemented} |\n`;
    output += `| Partially Implemented | ${ssp.controlSummary.partiallyImplemented} |\n`;
    output += `| Planned | ${ssp.controlSummary.planned} |\n`;
    output += `| Not Applicable | ${ssp.controlSummary.notApplicable} |\n`;
    output += `| **Total** | **${ssp.controlSummary.totalControls}** |\n\n`;

    // Group by family
    const byFamily = new Map<string, ControlImplementationStatement[]>();
    for (const impl of ssp.controlImplementations) {
      const family = impl.controlId.split('-')[0];
      const existing = byFamily.get(family) || [];
      existing.push(impl);
      byFamily.set(family, existing);
    }

    for (const [family, impls] of Array.from(byFamily.entries())) {
      output += `## ${family} Family\n\n`;

      for (const impl of impls.sort((a, b) => a.controlId.localeCompare(b.controlId))) {
        output += `### ${impl.controlId} - ${impl.controlName}\n\n`;
        output += `**Implementation Status:** ${impl.implementationStatus}\n\n`;
        output += `**Control Origination:** ${impl.origination}\n\n`;
        output += `**Responsible Roles:** ${impl.responsibleRoles.join(', ')}\n\n`;
        output += `**Implementation Description:**\n\n${impl.implementationDescription}\n\n`;

        if (impl.parameters && impl.parameters.length > 0) {
          output += `**Parameter Values:**\n\n`;
          for (const param of impl.parameters) {
            output += `- ${param.parameterId}: ${param.value}\n`;
          }
          output += `\n`;
        }

        if (impl.customerResponsibilityStatement) {
          output += `**Customer Responsibility:**\n\n${impl.customerResponsibilityStatement}\n\n`;
        }

        if (impl.enhancements && impl.enhancements.length > 0) {
          output += `**Control Enhancements:**\n\n`;
          for (const enh of impl.enhancements) {
            output += `- ${enh.enhancementId}: ${enh.implementationStatus}\n`;
          }
          output += `\n`;
        }

        output += `---\n\n`;
      }
    }

    return output;
  }

  /**
   * Generate SSP summary report
   */
  generateSummaryReport(ssp: SystemSecurityPlan): SSPSummaryReport {
    const implementationGaps = ssp.controlImplementations.filter(
      (c) => c.implementationStatus !== 'implemented' && c.implementationStatus !== 'not-applicable'
    );

    const sharedControls = ssp.controlImplementations.filter(
      (c) => c.customerResponsibilityStatement !== undefined
    );

    return {
      generatedDate: new Date(),
      systemName: ssp.systemInformation.systemName,
      securityCategorization: ssp.systemInformation.securityCategorization,
      authorizationType: ssp.systemInformation.authorizationType,
      controlSummary: ssp.controlSummary,
      implementationGaps: implementationGaps.map((c) => ({
        controlId: c.controlId,
        controlName: c.controlName,
        status: c.implementationStatus,
      })),
      sharedControlsCount: sharedControls.length,
      componentCount: ssp.systemEnvironment.components.length,
      interconnectionCount: ssp.systemEnvironment.interconnections.length,
      externalServiceCount: ssp.systemEnvironment.externalServices.length,
      leveragedAuthorizationsCount: ssp.systemInformation.leveragedAuthorizations?.length || 0,
      readinessScore: this.calculateReadinessScore(ssp),
    };
  }

  /**
   * Calculate SSP readiness score
   */
  private calculateReadinessScore(ssp: SystemSecurityPlan): number {
    let score = 0;
    const totalWeight = 100;

    // Control implementation (60%)
    const implPercentage = (ssp.controlSummary.implemented / ssp.controlSummary.totalControls) * 100;
    score += (implPercentage / 100) * 60;

    // Documentation completeness (20%)
    const hasAllAttachments = ssp.attachments.length >= 10;
    score += hasAllAttachments ? 20 : (ssp.attachments.length / 10) * 20;

    // System description completeness (10%)
    const hasSystemInfo = ssp.systemInformation.systemDescription &&
                         ssp.systemInformation.systemPurpose &&
                         ssp.systemInformation.systemFunction;
    score += hasSystemInfo ? 10 : 5;

    // Boundary documentation (10%)
    const hasBoundaryDocs = ssp.systemEnvironment.components.length > 0 &&
                           ssp.systemEnvironment.dataFlows.length > 0;
    score += hasBoundaryDocs ? 10 : 5;

    return Math.round(score);
  }

  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private getProfileHref(level: 'low' | 'moderate' | 'high'): string {
    const profiles: Record<string, string> = {
      low: 'https://raw.githubusercontent.com/GSA/fedramp-automation/master/dist/content/rev5/baselines/json/FedRAMP_rev5_LOW-baseline_profile.json',
      moderate: 'https://raw.githubusercontent.com/GSA/fedramp-automation/master/dist/content/rev5/baselines/json/FedRAMP_rev5_MODERATE-baseline_profile.json',
      high: 'https://raw.githubusercontent.com/GSA/fedramp-automation/master/dist/content/rev5/baselines/json/FedRAMP_rev5_HIGH-baseline_profile.json',
    };
    return profiles[level];
  }

  private extractRoles(ssp: SystemSecurityPlan): Array<{ id: string; title: string }> {
    const roles = new Set<string>();

    for (const impl of ssp.controlImplementations) {
      for (const role of impl.responsibleRoles) {
        roles.add(role);
      }
    }

    return Array.from(roles).map((role) => ({
      id: role.toLowerCase().replace(/\s+/g, '-'),
      title: role,
    }));
  }

  private extractParties(ssp: SystemSecurityPlan): Array<{
    uuid: string;
    type: string;
    name: string;
  }> {
    return [
      {
        uuid: this.generateUUID(),
        type: 'organization',
        name: ssp.systemInformation.organizationName,
      },
    ];
  }
}

// =============================================================================
// TYPES FOR EXPORTS
// =============================================================================

export interface SSPSummaryReport {
  generatedDate: Date;
  systemName: string;
  securityCategorization: 'low' | 'moderate' | 'high';
  authorizationType: 'agency' | 'jab';
  controlSummary: SystemSecurityPlan['controlSummary'];
  implementationGaps: Array<{
    controlId: string;
    controlName: string;
    status: ImplementationStatus;
  }>;
  sharedControlsCount: number;
  componentCount: number;
  interconnectionCount: number;
  externalServiceCount: number;
  leveragedAuthorizationsCount: number;
  readinessScore: number;
}

/**
 * OSCAL System Security Plan format
 */
export interface OSCALSystemSecurityPlan {
  'system-security-plan': {
    uuid: string;
    metadata: {
      title: string;
      'last-modified': string;
      version: string;
      'oscal-version': string;
      roles: Array<{ id: string; title: string }>;
      parties: Array<{ uuid: string; type: string; name: string }>;
    };
    'import-profile': {
      href: string;
    };
    'system-characteristics': {
      'system-name': string;
      description: string;
      'system-ids': Array<{ 'identifier-type': string; id: string }>;
      'security-sensitivity-level': string;
      'system-information': {
        'information-types': Array<{
          title: string;
          description: string;
          categorizations: Array<{
            system: string;
            'information-type-ids': string[];
          }>;
        }>;
      };
      'authorization-boundary': {
        description: string;
      };
    };
    'system-implementation': {
      users: Array<{
        uuid: string;
        title: string;
        description: string;
        'role-ids': string[];
      }>;
      components: Array<{
        uuid: string;
        type: string;
        title: string;
        description: string;
        status: { state: string };
      }>;
    };
    'control-implementation': {
      description: string;
      'implemented-requirements': Array<{
        uuid: string;
        'control-id': string;
        statements: Array<{
          'statement-id': string;
          uuid: string;
          description: string;
        }>;
      }>;
    };
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default SSPGeneratorService;
