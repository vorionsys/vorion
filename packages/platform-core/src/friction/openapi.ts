/**
 * OpenAPI 3.1 Specification for the Friction Feedback Module API
 *
 * This module exports a comprehensive OpenAPI specification for all friction
 * feedback endpoints including feedback generation, signal recording, and
 * pattern analysis.
 *
 * @packageDocumentation
 */

import type { OpenAPIV3_1 } from 'openapi-types';

/**
 * OpenAPI 3.1 specification for the Friction module
 */
export const frictionOpenApiSpec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: {
    title: 'Vorion Friction Feedback Module API',
    version: '1.0.0',
    description: `
# Friction Feedback Module API

The Friction Feedback module provides human-readable explanations and actionable
guidance when agent actions are denied, escalated, or constrained. This improves
the agent experience and enables learning from governance decisions.

## Features

- **Feedback Generation**: Generate human-readable explanations for governance decisions
- **Understanding Signals**: Track how agents respond to friction feedback
- **Pattern Analysis**: Analyze agent understanding patterns to improve communication
- **Reviewer Decision Options**: Retrieve available options for human reviewers

## Implements

- FR119: Friction feedback generation
- FR120: Understanding signal recording
- FR121: Pattern analysis
- FR122: Reviewer decision options

## Authentication

All endpoints require Bearer token authentication with a valid tenant context.

## Rate Limiting

API requests are rate-limited per tenant. Rate limit headers are included in responses.
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
      url: '/api/v1/friction',
      description: 'Friction API v1 base path',
    },
  ],
  tags: [
    {
      name: 'Feedback',
      description: 'Friction feedback generation',
    },
    {
      name: 'Signals',
      description: 'Agent understanding signal management',
    },
    {
      name: 'Analysis',
      description: 'Pattern analysis and insights',
    },
    {
      name: 'Configuration',
      description: 'Friction configuration and options',
    },
  ],
  paths: {
    '/feedback': {
      post: {
        tags: ['Feedback'],
        summary: 'Generate friction feedback',
        operationId: 'generateFeedback',
        description: `
Generate friction feedback for a denied, escalated, or constrained action.

Returns:
- Human-readable explanation of why the action was blocked
- Actionable next steps the agent can take
- Trust improvement suggestions
- Constraint violation details
`,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GenerateFeedbackRequest' },
              examples: {
                denied: {
                  summary: 'Denied action feedback',
                  value: {
                    intentId: '550e8400-e29b-41d4-a716-446655440000',
                    agentId: '123e4567-e89b-12d3-a456-426614174000',
                    decision: {
                      intentId: 'intent-123',
                      action: 'deny',
                      constraintsEvaluated: [
                        {
                          constraintId: 'max-transaction-amount',
                          passed: false,
                          action: 'deny',
                          reason: 'Transaction amount exceeds limit',
                        },
                      ],
                      trustScore: 450,
                      trustLevel: 3,
                      decidedAt: '2024-01-15T10:30:00.000Z',
                    },
                    action: 'transfer_funds',
                    category: 'financial',
                    parameters: {
                      amount: 50000,
                      currency: 'USD',
                    },
                  },
                },
                escalated: {
                  summary: 'Escalated action feedback',
                  value: {
                    intentId: '550e8400-e29b-41d4-a716-446655440001',
                    agentId: '123e4567-e89b-12d3-a456-426614174000',
                    decision: {
                      intentId: 'intent-456',
                      action: 'escalate',
                      trustScore: 550,
                      trustLevel: 4,
                      decidedAt: '2024-01-15T10:35:00.000Z',
                    },
                    action: 'access_sensitive_data',
                    category: 'data-access',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Friction feedback generated successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FrictionFeedback' },
                example: {
                  feedbackId: 'fb-550e8400-e29b-41d4-a716-446655440000',
                  intentId: '550e8400-e29b-41d4-a716-446655440000',
                  agentId: '123e4567-e89b-12d3-a456-426614174000',
                  action: 'transfer_funds',
                  decision: 'deny',
                  explanation: 'Your request to transfer $50,000 was denied because it exceeds your current transaction limit of $10,000.',
                  nextSteps: [
                    'Request a limit increase through the approval workflow',
                    'Split the transaction into smaller amounts',
                    'Contact your administrator for emergency approval',
                  ],
                  trustContext: {
                    currentScore: 450,
                    currentLevel: 3,
                    requiredLevel: 5,
                    improvementSuggestions: [
                      'Complete additional verification steps',
                      'Build transaction history with smaller amounts',
                    ],
                  },
                  constraints: [
                    {
                      constraintId: 'max-transaction-amount',
                      name: 'Maximum Transaction Amount',
                      violated: true,
                      details: 'Limit: $10,000, Requested: $50,000',
                    },
                  ],
                  generatedAt: '2024-01-15T10:30:05.000Z',
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/signals': {
      post: {
        tags: ['Signals'],
        summary: 'Record an understanding signal',
        operationId: 'recordSignal',
        description: `
Record how an agent responded to friction feedback.

Signal types:
- \`acknowledged\`: Agent acknowledged the feedback
- \`confused\`: Agent indicated confusion
- \`retried_same\`: Agent retried the same action
- \`retried_modified\`: Agent retried with modifications
- \`escalated\`: Agent escalated to a human
- \`abandoned\`: Agent abandoned the action
`,
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RecordSignalRequest' },
              examples: {
                acknowledged: {
                  summary: 'Agent acknowledged feedback',
                  value: {
                    agentId: '123e4567-e89b-12d3-a456-426614174000',
                    feedbackId: 'fb-550e8400-e29b-41d4-a716-446655440000',
                    type: 'acknowledged',
                    responseTimeMs: 1500,
                  },
                },
                retriedModified: {
                  summary: 'Agent retried with modifications',
                  value: {
                    agentId: '123e4567-e89b-12d3-a456-426614174000',
                    feedbackId: 'fb-550e8400-e29b-41d4-a716-446655440000',
                    type: 'retried_modified',
                    responseTimeMs: 5000,
                    context: {
                      modification: 'reduced_amount',
                      newAmount: 5000,
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Signal recorded successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UnderstandingSignal' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/signals/{agentId}': {
      get: {
        tags: ['Signals'],
        summary: 'Get understanding signals for an agent',
        operationId: 'getSignals',
        description: 'Retrieve all understanding signals recorded for a specific agent.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            description: 'Agent UUID',
            schema: {
              type: 'string',
              format: 'uuid',
            },
          },
        ],
        responses: {
          '200': {
            description: 'List of understanding signals',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SignalsListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/analysis/{agentId}': {
      get: {
        tags: ['Analysis'],
        summary: 'Analyze understanding patterns',
        operationId: 'analyzePatterns',
        description: `
Analyze understanding patterns for an agent.

Returns:
- Acknowledgment rate
- Confusion rate
- Retry patterns
- Average response times
- Recommendations for improving communication
`,
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            description: 'Agent UUID',
            schema: {
              type: 'string',
              format: 'uuid',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Pattern analysis results',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PatternAnalysisResponse' },
                example: {
                  agentId: '123e4567-e89b-12d3-a456-426614174000',
                  analysis: {
                    totalSignals: 50,
                    acknowledgmentRate: 0.72,
                    confusionRate: 0.08,
                    retryRate: 0.15,
                    abandonmentRate: 0.05,
                    avgResponseTimeMs: 2500,
                    patterns: {
                      mostCommonResponse: 'acknowledged',
                      improvementTrend: 'positive',
                    },
                    recommendations: [
                      'Agent shows good comprehension of feedback',
                      'Consider reducing friction for routine operations',
                    ],
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/decision-options': {
      get: {
        tags: ['Configuration'],
        summary: 'Get reviewer decision options',
        operationId: 'getDecisionOptions',
        description: 'Retrieve available decision options for human reviewers when handling escalations.',
        responses: {
          '200': {
            description: 'List of decision options',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DecisionOptionsResponse' },
                example: {
                  options: [
                    {
                      value: 'approve',
                      label: 'Approve',
                      description: 'Allow the action to proceed',
                    },
                    {
                      value: 'approve_once',
                      label: 'Approve Once',
                      description: 'Allow this specific instance only',
                    },
                    {
                      value: 'deny',
                      label: 'Deny',
                      description: 'Block the action',
                    },
                    {
                      value: 'escalate_further',
                      label: 'Escalate Further',
                      description: 'Escalate to a higher authority',
                    },
                    {
                      value: 'request_modification',
                      label: 'Request Modification',
                      description: 'Ask the agent to modify the request',
                    },
                  ],
                },
              },
            },
          },
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
    schemas: {
      GenerateFeedbackRequest: {
        type: 'object',
        description: 'Request to generate friction feedback',
        required: ['intentId', 'agentId', 'decision', 'action'],
        properties: {
          intentId: {
            type: 'string',
            format: 'uuid',
            description: 'Intent UUID',
          },
          agentId: {
            type: 'string',
            format: 'uuid',
            description: 'Agent UUID',
          },
          decision: {
            $ref: '#/components/schemas/GovernanceDecision',
          },
          action: {
            type: 'string',
            description: 'The action that was attempted',
          },
          category: {
            type: 'string',
            description: 'Action category (e.g., financial, data-access)',
          },
          parameters: {
            type: 'object',
            additionalProperties: true,
            description: 'Action parameters',
          },
        },
      },
      GovernanceDecision: {
        type: 'object',
        description: 'Governance decision details',
        required: ['intentId', 'action', 'trustScore', 'trustLevel', 'decidedAt'],
        properties: {
          intentId: {
            type: 'string',
            description: 'Intent identifier',
          },
          action: {
            type: 'string',
            enum: ['allow', 'deny', 'escalate', 'constrain'],
            description: 'Decision action',
          },
          constraintsEvaluated: {
            type: 'array',
            items: { $ref: '#/components/schemas/ConstraintEvaluation' },
            description: 'Constraints that were evaluated',
          },
          trustScore: {
            type: 'integer',
            minimum: 0,
            maximum: 1000,
            description: 'Trust score at decision time',
          },
          trustLevel: {
            type: 'integer',
            minimum: 0,
            maximum: 7,
            description: 'Trust level at decision time',
          },
          decidedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Decision timestamp',
          },
        },
      },
      ConstraintEvaluation: {
        type: 'object',
        description: 'Result of constraint evaluation',
        required: ['constraintId', 'passed'],
        properties: {
          constraintId: {
            type: 'string',
            description: 'Constraint identifier',
          },
          passed: {
            type: 'boolean',
            description: 'Whether the constraint passed',
          },
          action: {
            type: 'string',
            description: 'Action taken due to this constraint',
          },
          reason: {
            type: 'string',
            description: 'Human-readable reason',
          },
          details: {
            type: 'object',
            additionalProperties: true,
            description: 'Additional details',
          },
          durationMs: {
            type: 'number',
            description: 'Evaluation duration in milliseconds',
          },
          evaluatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Evaluation timestamp',
          },
        },
      },
      FrictionFeedback: {
        type: 'object',
        description: 'Generated friction feedback',
        required: ['feedbackId', 'intentId', 'agentId', 'action', 'decision', 'explanation', 'nextSteps', 'generatedAt'],
        properties: {
          feedbackId: {
            type: 'string',
            description: 'Unique feedback identifier',
          },
          intentId: {
            type: 'string',
            format: 'uuid',
            description: 'Associated intent ID',
          },
          agentId: {
            type: 'string',
            format: 'uuid',
            description: 'Agent ID',
          },
          action: {
            type: 'string',
            description: 'The action that was attempted',
          },
          decision: {
            type: 'string',
            enum: ['deny', 'escalate', 'constrain'],
            description: 'Governance decision',
          },
          explanation: {
            type: 'string',
            description: 'Human-readable explanation',
          },
          nextSteps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Actionable next steps',
          },
          trustContext: {
            $ref: '#/components/schemas/TrustContext',
          },
          constraints: {
            type: 'array',
            items: { $ref: '#/components/schemas/ConstraintFeedback' },
            description: 'Constraint-specific feedback',
          },
          generatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Generation timestamp',
          },
        },
      },
      TrustContext: {
        type: 'object',
        description: 'Trust context for feedback',
        properties: {
          currentScore: {
            type: 'integer',
            description: 'Current trust score',
          },
          currentLevel: {
            type: 'integer',
            description: 'Current trust level',
          },
          requiredLevel: {
            type: 'integer',
            description: 'Required trust level for the action',
          },
          improvementSuggestions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Suggestions to improve trust',
          },
        },
      },
      ConstraintFeedback: {
        type: 'object',
        description: 'Feedback for a specific constraint',
        properties: {
          constraintId: {
            type: 'string',
            description: 'Constraint identifier',
          },
          name: {
            type: 'string',
            description: 'Human-readable constraint name',
          },
          violated: {
            type: 'boolean',
            description: 'Whether the constraint was violated',
          },
          details: {
            type: 'string',
            description: 'Violation details',
          },
        },
      },
      RecordSignalRequest: {
        type: 'object',
        description: 'Request to record an understanding signal',
        required: ['agentId', 'feedbackId', 'type', 'responseTimeMs'],
        properties: {
          agentId: {
            type: 'string',
            format: 'uuid',
            description: 'Agent UUID',
          },
          feedbackId: {
            type: 'string',
            description: 'Feedback ID that this signal responds to',
          },
          type: {
            type: 'string',
            enum: ['acknowledged', 'confused', 'retried_same', 'retried_modified', 'escalated', 'abandoned'],
            description: 'Signal type',
          },
          responseTimeMs: {
            type: 'number',
            minimum: 0,
            description: 'Time to respond in milliseconds',
          },
          context: {
            type: 'object',
            additionalProperties: true,
            description: 'Additional context for the signal',
          },
        },
      },
      UnderstandingSignal: {
        type: 'object',
        description: 'Recorded understanding signal',
        required: ['signalId', 'agentId', 'feedbackId', 'type', 'responseTimeMs', 'recordedAt'],
        properties: {
          signalId: {
            type: 'string',
            description: 'Unique signal identifier',
          },
          agentId: {
            type: 'string',
            format: 'uuid',
            description: 'Agent UUID',
          },
          feedbackId: {
            type: 'string',
            description: 'Associated feedback ID',
          },
          type: {
            type: 'string',
            enum: ['acknowledged', 'confused', 'retried_same', 'retried_modified', 'escalated', 'abandoned'],
            description: 'Signal type',
          },
          responseTimeMs: {
            type: 'number',
            description: 'Response time in milliseconds',
          },
          context: {
            type: 'object',
            additionalProperties: true,
            description: 'Signal context',
          },
          recordedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Recording timestamp',
          },
        },
      },
      SignalsListResponse: {
        type: 'object',
        description: 'List of understanding signals',
        properties: {
          agentId: {
            type: 'string',
            format: 'uuid',
            description: 'Agent UUID',
          },
          signals: {
            type: 'array',
            items: { $ref: '#/components/schemas/UnderstandingSignal' },
          },
          count: {
            type: 'integer',
            description: 'Total number of signals',
          },
        },
      },
      PatternAnalysisResponse: {
        type: 'object',
        description: 'Pattern analysis results',
        properties: {
          agentId: {
            type: 'string',
            format: 'uuid',
            description: 'Agent UUID',
          },
          analysis: {
            type: 'object',
            properties: {
              totalSignals: {
                type: 'integer',
                description: 'Total signals analyzed',
              },
              acknowledgmentRate: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Rate of acknowledged signals',
              },
              confusionRate: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Rate of confused signals',
              },
              retryRate: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Rate of retry signals',
              },
              abandonmentRate: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Rate of abandoned signals',
              },
              avgResponseTimeMs: {
                type: 'number',
                description: 'Average response time',
              },
              patterns: {
                type: 'object',
                properties: {
                  mostCommonResponse: {
                    type: 'string',
                    description: 'Most common signal type',
                  },
                  improvementTrend: {
                    type: 'string',
                    enum: ['positive', 'neutral', 'negative'],
                    description: 'Trend direction',
                  },
                },
              },
              recommendations: {
                type: 'array',
                items: { type: 'string' },
                description: 'Recommendations for improvement',
              },
            },
          },
        },
      },
      DecisionOptionsResponse: {
        type: 'object',
        description: 'Available reviewer decision options',
        properties: {
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                value: {
                  type: 'string',
                  description: 'Option value',
                },
                label: {
                  type: 'string',
                  description: 'Display label',
                },
                description: {
                  type: 'string',
                  description: 'Option description',
                },
              },
            },
          },
        },
      },
      Error: {
        type: 'object',
        description: 'Error response',
        properties: {
          error: {
            type: 'string',
            description: 'Error type',
          },
          message: {
            type: 'string',
            description: 'Error message',
          },
          details: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
            },
            description: 'Validation error details',
          },
        },
      },
    },
    responses: {
      ValidationError: {
        description: 'Validation error - invalid request body',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              error: 'Validation Error',
              message: 'Invalid request body',
              details: [
                {
                  code: 'invalid_type',
                  path: ['agentId'],
                  message: 'Expected string, received undefined',
                },
              ],
            },
          },
        },
      },
      Unauthorized: {
        description: 'Unauthorized - missing or invalid authentication',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: {
              error: 'Unauthorized',
              message: 'Tenant ID required',
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
              error: 'Internal Server Error',
              message: 'Failed to generate friction feedback',
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
export function getFrictionOpenApiSpecJson(): string {
  return JSON.stringify(frictionOpenApiSpec, null, 2);
}

/**
 * Get the OpenAPI specification object
 */
export function getFrictionOpenApiSpec(): OpenAPIV3_1.Document {
  return frictionOpenApiSpec;
}
