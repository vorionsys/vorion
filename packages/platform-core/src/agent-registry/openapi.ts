/**
 * OpenAPI 3.1 Specification for the Agent Registry Module API
 *
 * This module exports a comprehensive OpenAPI specification for all agent
 * registry endpoints including registration, trust scoring, attestations,
 * and lifecycle management.
 *
 * @packageDocumentation
 */

import type { OpenAPIV3_1 } from 'openapi-types';

/**
 * OpenAPI 3.1 specification for the Agent Registry module
 */
export const agentRegistryOpenApiSpec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: {
    title: 'Vorion Agent Registry Module API',
    version: '1.0.0',
    description: `
# Agent Registry Module API

The Agent Registry module provides comprehensive agent identity management,
trust scoring, and lifecycle operations for the Vorion platform. It implements
the Agent Anchor (A3I) system for agent identification and trust management.

## Features

- **Agent Registration**: Register new agents with CAR ID (Categorical Agentic Registry Identifier)
- **Trust Scoring**: Real-time trust score calculation and caching
- **Attestations**: Record and query behavioral attestations
- **Lifecycle Management**: State transitions with approval workflows
- **CAR ID Validation**: Validate and parse CAR ID strings

## CAR ID Format

Categorical Agentic Registry Identifiers follow this format:
\`\`\`
{registry}.{organization}.{agent-class}:{domains}-L{level}@{version}
\`\`\`

Example: \`vorion.acme-corp.data-processor:ABS-L5@1.0.0\`

## Trust Tiers

| Tier | Name | Score Range | Description |
|------|------|-------------|-------------|
| T0 | Sandbox | 0-199 | Isolated testing, maximum restrictions |
| T1 | Observed | 200-349 | Read-only, monitored |
| T2 | Provisional | 350-499 | Basic operations, heavy supervision |
| T3 | Monitored | 500-649 | Standard operations, continuous monitoring |
| T4 | Standard | 650-799 | External API access, policy-governed |
| T5 | Trusted | 800-875 | Cross-agent communication |
| T6 | Certified | 876-950 | Admin tasks, minimal oversight |
| T7 | Autonomous | 951-1000 | Full autonomy, self-governance |

## Authentication

All endpoints require Bearer token authentication with a valid tenant context.

## Rate Limiting

API requests are rate-limited per tenant. Standard rate limit headers are included.
`,
    contact: {
      name: 'Vorion API Support',
      email: 'api-support@vorion.io',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: '/v1',
      description: 'Agent Registry API v1 base path',
    },
  ],
  tags: [
    {
      name: 'Agents',
      description: 'Agent CRUD operations',
    },
    {
      name: 'Trust',
      description: 'Trust scoring and evaluation',
    },
    {
      name: 'Attestations',
      description: 'Behavioral attestation management',
    },
    {
      name: 'Lifecycle',
      description: 'Agent state transitions',
    },
    {
      name: 'Validation',
      description: 'CAR ID validation utilities',
    },
    {
      name: 'Health',
      description: 'Service health and status',
    },
  ],
  paths: {
    '/agents': {
      post: {
        tags: ['Agents'],
        summary: 'Register a new agent',
        operationId: 'registerAgent',
        description: `
Register a new agent in the registry.

The agent will be assigned a CAR ID based on the provided parameters and
initialized in the T0_SANDBOX state.

**Quota**: Subject to per-tenant agent limits.
`,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterAgentRequest' },
              example: {
                organization: 'acme-corp',
                agentClass: 'data-processor',
                domains: ['A', 'B', 'S'],
                level: 5,
                version: '1.0.0',
                description: 'Production data processing agent',
                metadata: {
                  team: 'data-engineering',
                  environment: 'production',
                },
                contactEmail: 'data-team@acme-corp.com',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Agent registered successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '409': { $ref: '#/components/responses/DuplicateCarId' },
          '429': { $ref: '#/components/responses/QuotaExceeded' },
          '500': { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    '/agents/{carId}': {
      get: {
        tags: ['Agents'],
        summary: 'Get agent by CAR ID',
        operationId: 'getAgent',
        description: `
Retrieve an agent by its CAR ID.

Results are cached for performance. The response includes cache metadata.
`,
        parameters: [
          { $ref: '#/components/parameters/CarIdPath' },
        ],
        responses: {
          '200': {
            description: 'Agent details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/InvalidCarId' },
          '404': { $ref: '#/components/responses/AgentNotFound' },
          '500': { $ref: '#/components/responses/ServerError' },
        },
      },
      patch: {
        tags: ['Agents'],
        summary: 'Update agent metadata',
        operationId: 'updateAgent',
        description: 'Update an agent\'s description, metadata, or contact email.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/CarIdPath' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateAgentRequest' },
              example: {
                description: 'Updated description',
                metadata: {
                  team: 'new-team',
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Agent updated successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/AgentNotFound' },
          '500': { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    '/query': {
      post: {
        tags: ['Agents'],
        summary: 'Query agents',
        operationId: 'queryAgents',
        description: `
Query agents with filtering and pagination.

Filter by organization, domains, trust levels, and states.
`,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/QueryAgentsRequest' },
              example: {
                organization: 'acme-corp',
                domains: ['A', 'B'],
                minTrustTier: 4,
                states: ['T4_STANDARD', 'T5_TRUSTED'],
                limit: 20,
                offset: 0,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Paginated list of agents',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    '/agents/{carId}/trust': {
      get: {
        tags: ['Trust'],
        summary: 'Get trust score for an agent',
        operationId: 'getTrustScore',
        description: `
Get the current trust score and tier for an agent.

The score is calculated from attestations and cached for performance.
Use \`?refresh=true\` to force recalculation.
`,
        parameters: [
          { $ref: '#/components/parameters/CarIdPath' },
          {
            name: 'refresh',
            in: 'query',
            description: 'Force score recalculation',
            schema: {
              type: 'string',
              enum: ['true', 'false'],
            },
          },
        ],
        responses: {
          '200': {
            description: 'Trust score details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TrustScoreResponse' },
                example: {
                  success: true,
                  data: {
                    score: 550,
                    tier: 5,
                    tierName: 'Trusted',
                    cached: true,
                    cacheAge: 30000,
                    factors: {
                      behavioral: 0.65,
                      credential: 0.7,
                      temporal: 0.55,
                      audit: 0.6,
                      volume: 0.5,
                    },
                    calculatedAt: '2024-01-15T10:30:00.000Z',
                  },
                  meta: {
                    requestId: 'req-123',
                    timestamp: '2024-01-15T10:30:05.000Z',
                    version: 'v1',
                  },
                },
              },
            },
          },
          '404': { $ref: '#/components/responses/AgentNotFound' },
          '500': { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    '/agents/{carId}/attestations': {
      post: {
        tags: ['Attestations'],
        summary: 'Submit an attestation',
        operationId: 'submitAttestation',
        description: `
Submit a behavioral attestation for an agent.

Attestation types:
- \`BEHAVIORAL\`: From agent actions
- \`CREDENTIAL\`: From credential verification
- \`AUDIT\`: From audit processes
- \`A2A\`: From agent-to-agent interactions
- \`MANUAL\`: From human operators

Outcomes:
- \`success\`: Positive attestation
- \`failure\`: Negative attestation
- \`warning\`: Neutral with caution
`,
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/CarIdPath' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SubmitAttestationRequest' },
              example: {
                type: 'BEHAVIORAL',
                outcome: 'success',
                action: 'data_export_completed',
                evidence: {
                  recordsProcessed: 10000,
                  durationMs: 5000,
                },
                source: 'data-pipeline',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Attestation submitted successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AttestationResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/AgentNotFound' },
          '500': { $ref: '#/components/responses/ServerError' },
        },
      },
      get: {
        tags: ['Attestations'],
        summary: 'Get attestations for an agent',
        operationId: 'getAttestations',
        description: 'Retrieve attestation history for an agent.',
        parameters: [
          { $ref: '#/components/parameters/CarIdPath' },
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of attestations to return',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
            },
          },
        ],
        responses: {
          '200': {
            description: 'List of attestations',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AttestationListResponse' },
              },
            },
          },
          '404': { $ref: '#/components/responses/AgentNotFound' },
          '500': { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    '/agents/{carId}/lifecycle': {
      post: {
        tags: ['Lifecycle'],
        summary: 'Transition agent state',
        operationId: 'transitionState',
        description: `
Request a state transition for an agent.

Available actions depend on current state:
- \`PROMOTE\`: Move to next trust tier
- \`REQUEST_APPROVAL\`: Request human approval for promotion
- \`QUARANTINE\`: Isolate agent for investigation
- \`RELEASE\`: Release from quarantine
- \`SUSPEND\`: Temporarily suspend agent
- \`REVOKE\`: Revoke agent credentials
- \`EXPEL\`: Permanently remove agent
- \`REINSTATE\`: Restore suspended agent

Some transitions require approval or specific conditions.
`,
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/CarIdPath' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TransitionStateRequest' },
              examples: {
                promote: {
                  summary: 'Promote agent',
                  value: {
                    action: 'PROMOTE',
                    reason: 'Agent has demonstrated consistent positive behavior over 30 days',
                    context: {
                      reviewedBy: 'admin@acme-corp.com',
                      attestationCount: 150,
                    },
                  },
                },
                quarantine: {
                  summary: 'Quarantine agent',
                  value: {
                    action: 'QUARANTINE',
                    reason: 'Anomalous behavior detected - pending investigation',
                    context: {
                      incidentId: 'INC-2024-001',
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'State transition completed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TransitionResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/AgentNotFound' },
          '409': { $ref: '#/components/responses/TransitionBlocked' },
          '500': { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    '/validate': {
      post: {
        tags: ['Validation'],
        summary: 'Validate a CAR ID string',
        operationId: 'validateCarId',
        description: `
Validate a CAR ID string and optionally check if it's registered.

Returns parsed components if valid.
`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['carId'],
                properties: {
                  carId: {
                    type: 'string',
                    description: 'CAR ID string to validate',
                  },
                },
              },
              example: {
                carId: 'vorion.acme-corp.data-processor:ABS-L5@1.0.0',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Validation result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ValidateCarIdResponse' },
                examples: {
                  valid: {
                    summary: 'Valid and registered CAR ID',
                    value: {
                      success: true,
                      data: {
                        valid: true,
                        registered: true,
                        parsed: {
                          registry: 'vorion',
                          organization: 'acme-corp',
                          agentClass: 'data-processor',
                          domains: ['A', 'B', 'S'],
                          level: 5,
                          version: '1.0.0',
                        },
                        agent: {
                          state: 'T5_TRUSTED',
                          trustScore: 550,
                          trustTier: 5,
                        },
                      },
                      meta: {
                        requestId: 'req-123',
                        timestamp: '2024-01-15T10:30:00.000Z',
                        version: 'v1',
                      },
                    },
                  },
                  invalid: {
                    summary: 'Invalid CAR ID format',
                    value: {
                      success: true,
                      data: {
                        valid: false,
                        errors: [
                          {
                            code: 'INVALID_FORMAT',
                            message: 'CAR ID does not match expected format',
                          },
                        ],
                      },
                      meta: {
                        requestId: 'req-456',
                        timestamp: '2024-01-15T10:30:00.000Z',
                        version: 'v1',
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { $ref: '#/components/responses/ServerError' },
        },
      },
    },
    '/a3i/health': {
      get: {
        tags: ['Health'],
        summary: 'A3I cache health check',
        operationId: 'getA3IHealth',
        description: 'Check the health of the A3I caching layer and sync status.',
        responses: {
          '200': {
            description: 'Health check response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: {
                  success: true,
                  data: {
                    status: 'healthy',
                    cacheHitRate: 0.85,
                    avgLatencyMs: 5,
                    syncStatus: {
                      lastSync: '2024-01-15T10:29:00.000Z',
                      pendingAttestations: 3,
                      syncErrors: 0,
                    },
                  },
                  meta: {
                    requestId: 'req-789',
                    timestamp: '2024-01-15T10:30:00.000Z',
                    version: 'v1',
                  },
                },
              },
            },
          },
          '503': { $ref: '#/components/responses/HealthCheckFailed' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token with tenantId claim',
      },
    },
    parameters: {
      CarIdPath: {
        name: 'carId',
        in: 'path',
        required: true,
        description: 'Categorical Agentic Registry Identifier',
        schema: {
          type: 'string',
        },
      },
    },
    schemas: {
      RegisterAgentRequest: {
        type: 'object',
        description: 'Request to register a new agent',
        required: ['organization', 'agentClass', 'domains', 'level', 'version'],
        properties: {
          organization: {
            type: 'string',
            minLength: 2,
            maxLength: 63,
            pattern: '^[a-z0-9-]+$',
            description: 'Organization identifier',
          },
          agentClass: {
            type: 'string',
            minLength: 2,
            maxLength: 63,
            pattern: '^[a-z0-9-]+$',
            description: 'Agent class identifier',
          },
          domains: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'S'],
            },
            minItems: 1,
            description: 'Agent domain capabilities',
          },
          level: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            description: 'Agent autonomy level',
          },
          version: {
            type: 'string',
            pattern: '^\\d+\\.\\d+\\.\\d+$',
            description: 'Semantic version',
          },
          description: {
            type: 'string',
            maxLength: 500,
            description: 'Agent description',
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
            description: 'Custom metadata',
          },
          contactEmail: {
            type: 'string',
            format: 'email',
            description: 'Contact email',
          },
        },
      },
      UpdateAgentRequest: {
        type: 'object',
        description: 'Request to update agent metadata',
        properties: {
          description: {
            type: 'string',
            maxLength: 500,
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
          },
          contactEmail: {
            type: 'string',
            format: 'email',
          },
        },
      },
      QueryAgentsRequest: {
        type: 'object',
        description: 'Query parameters for agent search',
        properties: {
          organization: {
            type: 'string',
            description: 'Filter by organization',
          },
          domains: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'S'],
            },
            description: 'Filter by domains',
          },
          minLevel: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            description: 'Minimum autonomy level',
          },
          minTrustTier: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            description: 'Minimum trust tier',
          },
          states: {
            type: 'array',
            items: { $ref: '#/components/schemas/AgentState' },
            description: 'Filter by states',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
            description: 'Page size',
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Page offset',
          },
        },
      },
      SubmitAttestationRequest: {
        type: 'object',
        description: 'Request to submit an attestation',
        required: ['type', 'outcome', 'action'],
        properties: {
          type: {
            type: 'string',
            enum: ['BEHAVIORAL', 'CREDENTIAL', 'AUDIT', 'A2A', 'MANUAL'],
            description: 'Attestation type',
          },
          outcome: {
            type: 'string',
            enum: ['success', 'failure', 'warning'],
            description: 'Attestation outcome',
          },
          action: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: 'Action being attested',
          },
          evidence: {
            type: 'object',
            additionalProperties: true,
            description: 'Supporting evidence',
          },
          source: {
            type: 'string',
            description: 'Source system',
          },
          sourceCarId: {
            type: 'string',
            description: 'Source agent CAR ID (for A2A attestations)',
          },
        },
      },
      TransitionStateRequest: {
        type: 'object',
        description: 'Request to transition agent state',
        required: ['action', 'reason'],
        properties: {
          action: {
            type: 'string',
            enum: ['PROMOTE', 'REQUEST_APPROVAL', 'QUARANTINE', 'RELEASE', 'SUSPEND', 'REVOKE', 'EXPEL', 'REINSTATE'],
            description: 'State action',
          },
          reason: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description: 'Reason for transition',
          },
          context: {
            type: 'object',
            additionalProperties: true,
            description: 'Additional context',
          },
        },
      },
      Agent: {
        type: 'object',
        description: 'Agent entity',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Internal ID',
          },
          carId: {
            type: 'string',
            description: 'Categorical Agentic Registry Identifier',
          },
          tenantId: {
            type: 'string',
            description: 'Tenant ID',
          },
          organization: {
            type: 'string',
          },
          agentClass: {
            type: 'string',
          },
          domains: {
            type: 'array',
            items: { type: 'string' },
          },
          level: {
            type: 'integer',
          },
          version: {
            type: 'string',
          },
          state: { $ref: '#/components/schemas/AgentState' },
          trustScore: {
            type: 'integer',
            minimum: 0,
            maximum: 1000,
          },
          trustTier: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
          },
          description: {
            type: ['string', 'null'],
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
          },
          contactEmail: {
            type: ['string', 'null'],
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      AgentState: {
        type: 'string',
        enum: [
          'T0_SANDBOX', 'T1_OBSERVED', 'T2_PROVISIONAL', 'T3_MONITORED',
          'T4_STANDARD', 'T5_TRUSTED', 'T6_CERTIFIED', 'T7_AUTONOMOUS',
          'QUARANTINE', 'SUSPENDED', 'REVOKED', 'EXPELLED',
        ],
        description: 'Agent lifecycle state',
      },
      Attestation: {
        type: 'object',
        description: 'Attestation record',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          agentId: {
            type: 'string',
            format: 'uuid',
          },
          tenantId: {
            type: 'string',
          },
          type: {
            type: 'string',
            enum: ['BEHAVIORAL', 'CREDENTIAL', 'AUDIT', 'A2A', 'MANUAL'],
          },
          outcome: {
            type: 'string',
            enum: ['success', 'failure', 'warning'],
          },
          action: {
            type: 'string',
          },
          evidence: {
            type: 'object',
            additionalProperties: true,
          },
          source: {
            type: ['string', 'null'],
          },
          sourceCarId: {
            type: ['string', 'null'],
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      AgentResponse: {
        type: 'object',
        description: 'Standard agent response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            allOf: [
              { $ref: '#/components/schemas/Agent' },
              {
                type: 'object',
                properties: {
                  cached: { type: 'boolean' },
                  cacheAge: { type: 'integer' },
                },
              },
            ],
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      AgentListResponse: {
        type: 'object',
        description: 'Paginated agent list response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Agent' },
          },
          pagination: {
            type: 'object',
            properties: {
              offset: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
              hasMore: { type: 'boolean' },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      TrustScoreResponse: {
        type: 'object',
        description: 'Trust score response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            properties: {
              score: {
                type: 'integer',
                minimum: 0,
                maximum: 1000,
              },
              tier: {
                type: 'integer',
                minimum: 0,
                maximum: 7,
              },
              tierName: {
                type: 'string',
              },
              cached: {
                type: 'boolean',
              },
              cacheAge: {
                type: 'integer',
                description: 'Cache age in milliseconds',
              },
              factors: {
                type: 'object',
                properties: {
                  behavioral: { type: 'number' },
                  credential: { type: 'number' },
                  temporal: { type: 'number' },
                  audit: { type: 'number' },
                  volume: { type: 'number' },
                },
              },
              calculatedAt: {
                type: 'string',
                format: 'date-time',
              },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      AttestationResponse: {
        type: 'object',
        description: 'Attestation submission response',
        properties: {
          success: { type: 'boolean', const: true },
          data: { $ref: '#/components/schemas/Attestation' },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      AttestationListResponse: {
        type: 'object',
        description: 'Attestation list response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Attestation' },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      TransitionResponse: {
        type: 'object',
        description: 'State transition response',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              previousState: { $ref: '#/components/schemas/AgentState' },
              newState: { $ref: '#/components/schemas/AgentState' },
              transitionId: { type: 'string', format: 'uuid' },
              error: { type: 'string' },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      ValidateCarIdResponse: {
        type: 'object',
        description: 'CAR ID validation response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            properties: {
              valid: { type: 'boolean' },
              registered: { type: 'boolean' },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
              parsed: {
                type: 'object',
                properties: {
                  registry: { type: 'string' },
                  organization: { type: 'string' },
                  agentClass: { type: 'string' },
                  domains: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  level: { type: 'integer' },
                  version: { type: 'string' },
                },
              },
              agent: {
                type: 'object',
                properties: {
                  state: { $ref: '#/components/schemas/AgentState' },
                  trustScore: { type: 'integer' },
                  trustTier: { type: 'integer' },
                },
              },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      HealthResponse: {
        type: 'object',
        description: 'Health check response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['healthy', 'degraded', 'unhealthy'],
              },
              cacheHitRate: { type: 'number' },
              avgLatencyMs: { type: 'number' },
              syncStatus: {
                type: 'object',
                properties: {
                  lastSync: { type: 'string', format: 'date-time' },
                  pendingAttestations: { type: 'integer' },
                  syncErrors: { type: 'integer' },
                },
              },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
      ResponseMeta: {
        type: 'object',
        description: 'Response metadata',
        properties: {
          requestId: {
            type: 'string',
            description: 'Request identifier',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Response timestamp',
          },
          version: {
            type: 'string',
            description: 'API version',
          },
        },
      },
      Error: {
        type: 'object',
        description: 'Error response',
        properties: {
          success: { type: 'boolean', const: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          meta: { $ref: '#/components/schemas/ResponseMeta' },
        },
      },
    },
    responses: {
      ValidationError: {
        description: 'Validation error - invalid request',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid request body',
                details: [
                  { path: ['organization'], message: 'Required' },
                ],
              },
              meta: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                version: 'v1',
              },
            },
          },
        },
      },
      Unauthorized: {
        description: 'Unauthorized - authentication required',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'AUTH_REQUIRED',
                message: 'Authentication required',
              },
              meta: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                version: 'v1',
              },
            },
          },
        },
      },
      InvalidCarId: {
        description: 'Invalid CAR ID format',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'INVALID_CAR_ID',
                message: 'Invalid CAR format',
              },
              meta: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                version: 'v1',
              },
            },
          },
        },
      },
      AgentNotFound: {
        description: 'Agent not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'AGENT_NOT_FOUND',
                message: 'Agent not found',
              },
              meta: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                version: 'v1',
              },
            },
          },
        },
      },
      DuplicateCarId: {
        description: 'Agent with this CAR ID already exists',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'DUPLICATE_CAR_ID',
                message: 'Agent with CAR ID already exists',
              },
              meta: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                version: 'v1',
              },
            },
          },
        },
      },
      QuotaExceeded: {
        description: 'Agent quota exceeded',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'QUOTA_EXCEEDED',
                message: 'Agent limit exceeded for tenant',
              },
              meta: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                version: 'v1',
              },
            },
          },
        },
      },
      TransitionBlocked: {
        description: 'State transition blocked',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'LIFECYCLE_BLOCKED',
                message: 'Transition blocked: insufficient trust score',
              },
              meta: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                version: 'v1',
              },
            },
          },
        },
      },
      ServerError: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'SERVER_ERROR',
                message: 'An unexpected error occurred',
              },
              meta: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                version: 'v1',
              },
            },
          },
        },
      },
      HealthCheckFailed: {
        description: 'Health check failed',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'HEALTH_CHECK_FAILED',
                message: 'Health check failed',
              },
              meta: {
                requestId: 'req-123',
                timestamp: '2024-01-15T10:30:00.000Z',
                version: 'v1',
              },
            },
          },
        },
      },
    },
  },
  security: [
    { bearerAuth: [] },
  ],
};

/**
 * Get the OpenAPI specification as a JSON string
 */
export function getAgentRegistryOpenApiSpecJson(): string {
  return JSON.stringify(agentRegistryOpenApiSpec, null, 2);
}

/**
 * Get the OpenAPI specification object
 */
export function getAgentRegistryOpenApiSpec(): OpenAPIV3_1.Document {
  return agentRegistryOpenApiSpec;
}
