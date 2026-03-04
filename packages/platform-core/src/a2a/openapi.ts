/**
 * OpenAPI 3.1 Specification for the A2A (Agent-to-Agent) Module API
 *
 * This module exports a comprehensive OpenAPI specification for all A2A-related
 * endpoints including invoke, discovery, chain-of-trust, and health operations.
 *
 * @packageDocumentation
 */

import type { OpenAPIV3_1 } from 'openapi-types';

/**
 * OpenAPI 3.1 specification for the A2A module
 */
export const a2aOpenApiSpec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: {
    title: 'Vorion A2A (Agent-to-Agent) Module API',
    version: '1.0.0',
    description: `
# A2A Module API

The A2A (Agent-to-Agent) module provides secure, trust-aware communication between
agents in the Vorion platform. It handles invoke requests, endpoint discovery,
chain-of-trust management, and attestation recording.

## Features

- **Agent Invocation**: Synchronous and asynchronous action invocation between agents
- **Trust Negotiation**: Automatic trust context building and validation
- **Chain-of-Trust**: Cryptographic chain tracking for audit and compliance
- **Endpoint Discovery**: Find agents by capabilities, actions, or trust requirements
- **Health Monitoring**: Real-time status of agents and communication infrastructure

## Authentication

All endpoints require the caller's CAR ID (Categorical Agentic Registry identifier) to be provided
via the \`X-Agent-CAR-ID\` header or extracted from the authenticated context.

## Trust Tiers

Trust tiers range from 0 (Sandbox) to 7 (Autonomous):
- **T0-T2**: Restricted operations, heavy monitoring
- **T3-T4**: Standard operations with audit logging
- **T5-T6**: Trusted operations with reduced friction
- **T7**: Autonomous operations (rare, requires certification)

## Rate Limiting

API requests are rate-limited per agent. Rate limit headers are included in responses:
- \`X-RateLimit-Limit\`: Maximum requests per window
- \`X-RateLimit-Remaining\`: Remaining requests in current window
- \`X-RateLimit-Reset\`: Unix timestamp when the window resets
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
      url: '/v1/a2a',
      description: 'A2A API v1 base path',
    },
  ],
  tags: [
    {
      name: 'Invoke',
      description: 'Agent-to-agent action invocation',
    },
    {
      name: 'Discovery',
      description: 'Agent endpoint discovery and registration',
    },
    {
      name: 'Chain',
      description: 'Chain-of-trust visualization and monitoring',
    },
    {
      name: 'Health',
      description: 'Service health and connectivity checks',
    },
  ],
  paths: {
    '/invoke': {
      post: {
        tags: ['Invoke'],
        summary: 'Invoke an action on another agent',
        operationId: 'invokeAgent',
        description: `
Invoke an action on a target agent. Supports both synchronous and asynchronous invocation.

**Trust Negotiation**: The caller's trust context is automatically built and validated
against the target agent's requirements before the invocation proceeds.

**Chain-of-Trust**: Each invocation is tracked in a cryptographic chain for audit
and compliance purposes.

**Timeout Handling**: Default timeout is 30 seconds. For long-running operations,
use async mode to receive a message ID for later polling.
`,
        parameters: [
          { $ref: '#/components/parameters/AgentCarId' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InvokeRequest' },
              examples: {
                sync: {
                  summary: 'Synchronous invocation',
                  value: {
                    targetCarId: 'vorion.acme-corp.data-processor:ABS-L5@1.0.0',
                    action: 'processData',
                    params: {
                      datasetId: 'ds-12345',
                      format: 'json',
                    },
                    timeoutMs: 30000,
                  },
                },
                async: {
                  summary: 'Asynchronous invocation',
                  value: {
                    targetCarId: 'vorion.acme-corp.ml-trainer:AI-L6@2.0.0',
                    action: 'trainModel',
                    params: {
                      modelId: 'model-789',
                      epochs: 100,
                    },
                    async: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Synchronous invocation completed successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InvokeSuccessResponse' },
              },
            },
          },
          '202': {
            description: 'Asynchronous invocation accepted',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AsyncInvokeResponse' },
                example: {
                  success: true,
                  data: {
                    requestId: '550e8400-e29b-41d4-a716-446655440000',
                    messageId: 'msg-123456',
                    status: 'pending',
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/TrustInsufficient' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/discover': {
      get: {
        tags: ['Discovery'],
        summary: 'Discover available agents',
        operationId: 'discoverAgents',
        description: `
Discover available agent endpoints that match the specified criteria.

Results are filtered based on:
- Required capabilities
- Minimum trust tier
- Supported actions

Internal endpoint details are sanitized before being returned.
`,
        parameters: [
          {
            name: 'capabilities',
            in: 'query',
            description: 'Filter by required capabilities (comma-separated)',
            schema: {
              type: 'array',
              items: { type: 'string' },
            },
            style: 'form',
            explode: false,
          },
          {
            name: 'minTier',
            in: 'query',
            description: 'Minimum trust tier (0-7)',
            schema: {
              type: 'integer',
              minimum: 0,
              maximum: 7,
            },
          },
          {
            name: 'action',
            in: 'query',
            description: 'Filter by supported action name',
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'List of discovered endpoints',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DiscoverResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/register': {
      post: {
        tags: ['Discovery'],
        summary: 'Register an agent endpoint',
        operationId: 'registerEndpoint',
        description: `
Register a new agent endpoint for discovery and invocation.

**Note**: This endpoint is typically used internally during agent startup.
The endpoint will be health-checked periodically.
`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterEndpointRequest' },
              example: {
                carId: 'vorion.acme-corp.analyzer:ABS-L5@1.0.0',
                url: 'https://analyzer.acme-corp.internal:8443',
                versions: ['1.0', '1.1'],
                capabilities: ['data-analysis', 'reporting'],
                actions: [
                  {
                    name: 'analyze',
                    description: 'Analyze a dataset',
                    paramsSchema: { datasetId: { type: 'string' } },
                    resultSchema: { report: { type: 'object' } },
                    minTier: 4,
                    streaming: false,
                  },
                ],
                trustRequirements: {
                  minTier: 4,
                  requiredCapabilities: ['data-read'],
                  requireMtls: true,
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Endpoint registered successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', const: true },
                    data: {
                      type: 'object',
                      properties: {
                        carId: { type: 'string' },
                        registered: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/register/{carId}': {
      delete: {
        tags: ['Discovery'],
        summary: 'Unregister an agent endpoint',
        operationId: 'unregisterEndpoint',
        description: 'Remove an agent endpoint from the registry.',
        parameters: [
          {
            name: 'carId',
            in: 'path',
            required: true,
            description: 'Categorical Agentic Registry identifier',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Endpoint unregistered successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', const: true },
                    data: {
                      type: 'object',
                      properties: {
                        carId: { type: 'string' },
                        unregistered: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/chain/{requestId}': {
      get: {
        tags: ['Chain'],
        summary: 'Get chain-of-trust information',
        operationId: 'getChain',
        description: `
Retrieve chain-of-trust information for a specific request.

Returns:
- Chain links with agent participation
- Trust levels and scores at each hop
- Visualization data for UI rendering
- Validation status
`,
        parameters: [
          {
            name: 'requestId',
            in: 'path',
            required: true,
            description: 'Request UUID from the original invocation',
            schema: {
              type: 'string',
              format: 'uuid',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Chain-of-trust information',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChainResponse' },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/chains': {
      get: {
        tags: ['Chain'],
        summary: 'List active chains',
        operationId: 'listChains',
        description: 'List all currently active chains for monitoring purposes.',
        responses: {
          '200': {
            description: 'List of active chains',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChainsListResponse' },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'A2A system health check',
        operationId: 'getHealth',
        description: `
Check the health status of the A2A system including:
- Router status and endpoint counts
- Circuit breaker states
- Active chain statistics
- Pending attestation counts
`,
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
                    router: {
                      endpoints: 15,
                      pendingRequests: 3,
                      circuitBreakers: [],
                    },
                    chains: {
                      active: 5,
                      completed: 1234,
                      failed: 12,
                      avgDepth: '2.34',
                    },
                    attestations: {
                      pending: 7,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/ping': {
      post: {
        tags: ['Health'],
        summary: 'Ping another agent',
        operationId: 'pingAgent',
        description: 'Check if a target agent is reachable and healthy.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['targetCarId'],
                properties: {
                  targetCarId: {
                    type: 'string',
                    description: 'Target agent CAR ID',
                  },
                },
              },
              example: {
                targetCarId: 'vorion.acme-corp.processor:ABS-L5@1.0.0',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Ping response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PingResponse' },
                examples: {
                  reachable: {
                    summary: 'Agent is reachable',
                    value: {
                      success: true,
                      data: {
                        targetCarId: 'vorion.acme-corp.processor:ABS-L5@1.0.0',
                        reachable: true,
                        status: 'healthy',
                        capabilities: ['data-processing', 'reporting'],
                        lastHealthCheck: '2024-01-15T10:30:00.000Z',
                      },
                    },
                  },
                  unreachable: {
                    summary: 'Agent not registered',
                    value: {
                      success: true,
                      data: {
                        targetCarId: 'vorion.unknown.agent:X-L0@1.0.0',
                        reachable: false,
                        reason: 'Endpoint not registered',
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
  },
  components: {
    parameters: {
      AgentCarId: {
        name: 'X-Agent-CAR-ID',
        in: 'header',
        required: true,
        description: 'Caller Categorical Agentic Registry identifier',
        schema: {
          type: 'string',
        },
      },
    },
    schemas: {
      InvokeRequest: {
        type: 'object',
        description: 'Request body for agent invocation',
        required: ['targetCarId', 'action'],
        properties: {
          targetCarId: {
            type: 'string',
            description: 'Target agent CAR ID to invoke',
          },
          action: {
            type: 'string',
            minLength: 1,
            description: 'Action name to invoke on the target agent',
          },
          params: {
            type: 'object',
            additionalProperties: true,
            default: {},
            description: 'Parameters to pass to the action',
          },
          timeoutMs: {
            type: 'number',
            minimum: 1,
            description: 'Timeout in milliseconds (default: 30000)',
          },
          async: {
            type: 'boolean',
            description: 'If true, return immediately with a message ID',
          },
          stream: {
            type: 'boolean',
            description: 'If true, stream the response (if supported)',
          },
        },
      },
      InvokeSuccessResponse: {
        type: 'object',
        description: 'Successful synchronous invocation response',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              requestId: {
                type: 'string',
                format: 'uuid',
                description: 'Unique request identifier',
              },
              success: {
                type: 'boolean',
                description: 'Whether the invocation succeeded',
              },
              result: {
                type: 'object',
                additionalProperties: true,
                description: 'Result data from the target agent',
              },
              error: {
                $ref: '#/components/schemas/ErrorDetail',
              },
              metrics: {
                $ref: '#/components/schemas/InvokeMetrics',
              },
              trustChain: {
                type: 'array',
                items: { $ref: '#/components/schemas/ChainLink' },
                description: 'Trust chain links for this invocation',
              },
              attestation: {
                $ref: '#/components/schemas/AttestationData',
              },
            },
          },
        },
      },
      AsyncInvokeResponse: {
        type: 'object',
        description: 'Asynchronous invocation accepted response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            properties: {
              requestId: {
                type: 'string',
                format: 'uuid',
              },
              messageId: {
                type: 'string',
                description: 'Message ID for tracking',
              },
              status: {
                type: 'string',
                const: 'pending',
              },
            },
          },
        },
      },
      InvokeMetrics: {
        type: 'object',
        description: 'Metrics from an invocation',
        properties: {
          durationMs: {
            type: 'number',
            description: 'Total duration in milliseconds',
          },
          subCallCount: {
            type: 'integer',
            description: 'Number of sub-calls made by the target',
          },
        },
      },
      ChainLink: {
        type: 'object',
        description: 'A link in the chain-of-trust',
        properties: {
          carId: {
            type: 'string',
            description: 'Agent CAR ID',
          },
          tier: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            description: 'Trust tier at this link',
          },
          score: {
            type: 'integer',
            minimum: 0,
            maximum: 1000,
            description: 'Trust score at this link',
          },
          action: {
            type: 'string',
            description: 'Action performed',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'When this link was created',
          },
          requestId: {
            type: 'string',
            format: 'uuid',
            description: 'Associated request ID',
          },
        },
      },
      AttestationData: {
        type: 'object',
        description: 'Attestation data for an invocation',
        properties: {
          callerCarId: { type: 'string' },
          calleeCarId: { type: 'string' },
          action: { type: 'string' },
          success: { type: 'boolean' },
          responseTimeMs: { type: 'number' },
          trustNegotiated: { type: 'boolean' },
          trustRequirementsMet: { type: 'boolean' },
          violations: {
            type: 'array',
            items: { type: 'string' },
          },
          chainDepth: { type: 'integer' },
          delegationUsed: { type: 'boolean' },
        },
      },
      RegisterEndpointRequest: {
        type: 'object',
        description: 'Request to register an agent endpoint',
        required: ['carId', 'url'],
        properties: {
          carId: {
            type: 'string',
            minLength: 1,
            description: 'Categorical Agentic Registry identifier',
          },
          url: {
            type: 'string',
            format: 'uri',
            description: 'Endpoint URL',
          },
          versions: {
            type: 'array',
            items: { type: 'string' },
            default: ['1.0'],
            description: 'Supported API versions',
          },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
            default: [],
            description: 'Agent capabilities',
          },
          actions: {
            type: 'array',
            items: { $ref: '#/components/schemas/AgentAction' },
            default: [],
            description: 'Available actions',
          },
          trustRequirements: {
            $ref: '#/components/schemas/TrustRequirements',
          },
        },
      },
      AgentAction: {
        type: 'object',
        description: 'An action exposed by an agent',
        required: ['name', 'description'],
        properties: {
          name: {
            type: 'string',
            description: 'Action name',
          },
          description: {
            type: 'string',
            description: 'Action description',
          },
          paramsSchema: {
            type: 'object',
            additionalProperties: true,
            description: 'JSON Schema for parameters',
          },
          resultSchema: {
            type: 'object',
            additionalProperties: true,
            description: 'JSON Schema for results',
          },
          minTier: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            default: 5,
            description: 'Minimum trust tier required',
          },
          requiredCapabilities: {
            type: 'array',
            items: { type: 'string' },
            default: [],
            description: 'Required caller capabilities',
          },
          streaming: {
            type: 'boolean',
            default: false,
            description: 'Whether streaming is supported',
          },
        },
      },
      TrustRequirements: {
        type: 'object',
        description: 'Trust requirements for an endpoint',
        properties: {
          minTier: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            default: 5,
            description: 'Minimum trust tier',
          },
          minScore: {
            type: 'integer',
            minimum: 0,
            maximum: 1000,
            description: 'Minimum trust score',
          },
          requiredCapabilities: {
            type: 'array',
            items: { type: 'string' },
            default: [],
            description: 'Required capabilities',
          },
          requiredAttestations: {
            type: 'array',
            items: { type: 'string' },
            description: 'Required attestation types',
          },
          maxChainDepth: {
            type: 'integer',
            minimum: 1,
            description: 'Maximum allowed chain depth',
          },
          requireMtls: {
            type: 'boolean',
            default: true,
            description: 'Whether mTLS is required',
          },
        },
      },
      DiscoverResponse: {
        type: 'object',
        description: 'Response from endpoint discovery',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            properties: {
              endpoints: {
                type: 'array',
                items: { $ref: '#/components/schemas/PublicEndpoint' },
              },
              count: {
                type: 'integer',
                description: 'Number of matching endpoints',
              },
            },
          },
        },
      },
      PublicEndpoint: {
        type: 'object',
        description: 'Publicly visible endpoint information',
        properties: {
          carId: { type: 'string' },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
          },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                minTier: { type: 'integer' },
                streaming: { type: 'boolean' },
              },
            },
          },
          trustRequirements: {
            type: 'object',
            properties: {
              minTier: { type: 'integer' },
              requiredCapabilities: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          status: {
            type: 'string',
            enum: ['healthy', 'degraded', 'unhealthy'],
          },
        },
      },
      ChainResponse: {
        type: 'object',
        description: 'Chain-of-trust response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            properties: {
              chain: {
                type: 'object',
                properties: {
                  rootRequestId: {
                    type: 'string',
                    format: 'uuid',
                  },
                  state: {
                    type: 'string',
                    enum: ['active', 'completed', 'failed'],
                  },
                  depth: { type: 'integer' },
                  effectiveTier: { type: 'integer' },
                  effectiveScore: { type: 'integer' },
                  inheritanceMode: { type: 'string' },
                  startedAt: { type: 'string', format: 'date-time' },
                  lastActivityAt: { type: 'string', format: 'date-time' },
                  links: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/ChainLink' },
                  },
                },
              },
              visualization: {
                type: 'string',
                description: 'ASCII visualization of the chain',
              },
              validation: {
                type: 'object',
                description: 'Chain validation results',
              },
            },
          },
        },
      },
      ChainsListResponse: {
        type: 'object',
        description: 'List of active chains',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            properties: {
              chains: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    rootRequestId: { type: 'string', format: 'uuid' },
                    state: { type: 'string' },
                    depth: { type: 'integer' },
                    effectiveTier: { type: 'integer' },
                    startedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              count: { type: 'integer' },
              stats: {
                type: 'object',
                properties: {
                  activeChains: { type: 'integer' },
                  completedChains: { type: 'integer' },
                  failedChains: { type: 'integer' },
                  avgChainDepth: { type: 'number' },
                },
              },
            },
          },
        },
      },
      HealthResponse: {
        type: 'object',
        description: 'A2A health check response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['healthy', 'degraded', 'unhealthy'],
              },
              router: {
                type: 'object',
                properties: {
                  endpoints: { type: 'integer' },
                  pendingRequests: { type: 'integer' },
                  circuitBreakers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        carId: { type: 'string' },
                        state: { type: 'string' },
                      },
                    },
                  },
                },
              },
              chains: {
                type: 'object',
                properties: {
                  active: { type: 'integer' },
                  completed: { type: 'integer' },
                  failed: { type: 'integer' },
                  avgDepth: { type: 'string' },
                },
              },
              attestations: {
                type: 'object',
                properties: {
                  pending: { type: 'integer' },
                },
              },
            },
          },
        },
      },
      PingResponse: {
        type: 'object',
        description: 'Ping response',
        properties: {
          success: { type: 'boolean', const: true },
          data: {
            type: 'object',
            properties: {
              targetCarId: { type: 'string' },
              reachable: { type: 'boolean' },
              reason: { type: 'string' },
              status: {
                type: 'string',
                enum: ['healthy', 'degraded', 'unhealthy'],
              },
              capabilities: {
                type: 'array',
                items: { type: 'string' },
              },
              lastHealthCheck: {
                type: 'string',
                format: 'date-time',
              },
            },
          },
        },
      },
      ErrorDetail: {
        type: 'object',
        description: 'Error detail object',
        properties: {
          code: {
            type: 'string',
            description: 'Error code',
          },
          message: {
            type: 'string',
            description: 'Error message',
          },
          details: {
            type: 'object',
            additionalProperties: true,
            description: 'Additional error details',
          },
        },
      },
      Error: {
        type: 'object',
        description: 'Standard error response',
        properties: {
          success: { type: 'boolean', const: false },
          error: { $ref: '#/components/schemas/ErrorDetail' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Bad request - invalid input',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'INVALID_REQUEST',
                message: 'Invalid request body',
              },
            },
          },
        },
      },
      Unauthorized: {
        description: 'Unauthorized - missing caller CAR ID',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'UNAUTHORIZED',
                message: 'Caller CAR ID required',
              },
            },
          },
        },
      },
      TrustInsufficient: {
        description: 'Forbidden - trust requirements not met',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'TRUST_INSUFFICIENT',
                message: 'Could not build trust context',
              },
            },
          },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: 'Chain not found',
              },
            },
          },
        },
      },
      InternalError: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: 'An unexpected error occurred',
              },
            },
          },
        },
      },
    },
  },
};

/**
 * Get the OpenAPI specification as a JSON string
 */
export function getA2AOpenApiSpecJson(): string {
  return JSON.stringify(a2aOpenApiSpec, null, 2);
}

/**
 * Get the OpenAPI specification object
 */
export function getA2AOpenApiSpec(): OpenAPIV3_1.Document {
  return a2aOpenApiSpec;
}
