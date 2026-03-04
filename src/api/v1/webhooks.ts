/**
 * API v1 Webhook Routes
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import {
  createWebhookService,
  verifyWebhookSignature,
  SIGNATURE_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
  type WebhookEventType,
} from '../../intent/webhooks.js';
import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import { requireTenantMembership } from '../../common/tenant-verification.js';
import { getWebhookSecurityDocumentation } from '../middleware/webhook-verify.js';

const webhookLogger = createLogger({ component: 'api-v1-webhooks' });
const webhookService = createWebhookService();

const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'escalation.created',
  'escalation.approved',
  'escalation.rejected',
  'escalation.timeout',
  'intent.approved',
  'intent.denied',
  'intent.completed',
];

const webhookCreateBodySchema = z.object({
  url: z.string().url(),
  secret: z.string().min(16).max(256).optional(),
  events: z.array(
    z.string().refine((value): value is WebhookEventType => WEBHOOK_EVENT_TYPES.includes(value as WebhookEventType), {
      message: 'Invalid webhook event type',
    })
  ).min(1),
  enabled: z.boolean().optional().default(true),
});

const webhookIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const webhookDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const webhookRotateSecretBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

const webhookVerifySignatureBodySchema = z.object({
  payload: z.string().min(1),
  signature: z.string().min(1),
  timestamp: z.number().int(),
  secret: z.string().min(1),
});

async function getTenantId(request: FastifyRequest): Promise<string> {
  const payload = await request.jwtVerify<{ tenantId?: string; sub?: string }>();

  if (!payload.tenantId) {
    throw new ForbiddenError('Tenant context missing from token');
  }

  if (!payload.sub) {
    throw new ForbiddenError('User identifier missing from token');
  }

  await requireTenantMembership(payload.sub, payload.tenantId);
  return payload.tenantId;
}

/**
 * Register v1 webhook routes
 */
export async function registerWebhookRoutesV1(fastify: FastifyInstance): Promise<void> {
  // Register webhook
  // POST /webhooks - Create a new webhook
  // Returns the webhook secret only once on creation
  fastify.post('/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const body = webhookCreateBodySchema.parse(request.body ?? {});

    try {
      // Use returnSecret option to get the secret back (only returned once)
      const result = await webhookService.registerWebhook(
        tenantId,
        {
          url: body.url,
          secret: body.secret,
          events: body.events,
          enabled: body.enabled ?? true,
        },
        { returnSecret: true }
      );

      const webhook = await webhookService.getWebhook(tenantId, result.webhookId);

      webhookLogger.info(
        { webhookId: result.webhookId, tenantId, url: body.url },
        'Webhook registered'
      );

      // Return the secret only on creation (won't be returned again)
      // Also include security documentation for verification
      return reply.code(201).send({
        id: result.webhookId,
        config: webhook ? {
          ...webhook,
          // Don't include the decrypted secret in config, we return it separately
          secret: undefined,
        } : undefined,
        // The secret is only returned once - store it securely!
        secret: result.secret,
        secretPrefix: webhook?.secretPrefix,
        security: {
          warning: 'Store this secret securely. It will not be shown again.',
          ...getWebhookSecurityDocumentation(),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Invalid webhook URL')) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_WEBHOOK_URL',
            message: error.message,
          },
        });
      }
      throw error;
    }
  });

  // List webhooks
  // GET /webhooks - List all webhooks for tenant
  // Note: Secrets are never returned in list - only secretPrefix is shown
  fastify.get('/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);

    const webhooks = await webhookService.getWebhooks(tenantId);

    return reply.send({
      data: webhooks.map((w) => ({
        id: w.id,
        config: {
          url: w.config.url,
          enabled: w.config.enabled,
          events: w.config.events,
          retryAttempts: w.config.retryAttempts,
          retryDelayMs: w.config.retryDelayMs,
          // Show only the secret prefix, not the actual secret
          secretPrefix: w.config.secretPrefix,
          hasSecret: !!w.config.secret || !!w.config.secretHash,
          lastRotatedAt: w.config.lastRotatedAt,
        },
      })),
    });
  });

  // Get single webhook
  // GET /webhooks/:id - Get a single webhook by ID
  fastify.get('/webhooks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const params = webhookIdParamsSchema.parse(request.params ?? {});

    const webhook = await webhookService.getWebhook(tenantId, params.id);
    if (!webhook) {
      return reply.status(404).send({
        error: { code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' },
      });
    }

    return reply.send({
      id: params.id,
      config: {
        url: webhook.url,
        enabled: webhook.enabled,
        events: webhook.events,
        retryAttempts: webhook.retryAttempts,
        retryDelayMs: webhook.retryDelayMs,
        secretPrefix: webhook.secretPrefix,
        hasSecret: !!webhook.secret || !!webhook.secretHash,
        lastRotatedAt: webhook.lastRotatedAt,
      },
    });
  });

  // Delete webhook
  fastify.delete('/webhooks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const params = webhookIdParamsSchema.parse(request.params ?? {});

    const deleted = await webhookService.unregisterWebhook(tenantId, params.id);
    if (!deleted) {
      return reply.status(404).send({
        error: { code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' },
      });
    }

    webhookLogger.info(
      { webhookId: params.id, tenantId },
      'Webhook unregistered'
    );

    return reply.status(204).send();
  });

  // Get webhook deliveries
  fastify.get('/webhooks/:id/deliveries', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const params = webhookIdParamsSchema.parse(request.params ?? {});
    const query = webhookDeliveriesQuerySchema.parse(request.query ?? {});

    const webhooks = await webhookService.getWebhooks(tenantId);
    const webhook = webhooks.find((w) => w.id === params.id);
    if (!webhook) {
      return reply.status(404).send({
        error: { code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' },
      });
    }

    const deliveries = await webhookService.getDeliveries(
      tenantId,
      params.id,
      query.limit ?? 100
    );

    return reply.send({
      data: deliveries.map((d) => ({
        id: d.id,
        result: d.result,
      })),
    });
  });

  // Rotate webhook secret
  // POST /webhooks/:id/rotate-secret - Generate a new secret for the webhook
  // Returns the new secret only once
  fastify.post('/webhooks/:id/rotate-secret', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = await getTenantId(request);
    const payload = await request.jwtVerify<{ sub?: string }>();
    const params = webhookIdParamsSchema.parse(request.params ?? {});
    const body = webhookRotateSecretBodySchema.parse(request.body ?? {});

    try {
      const result = await webhookService.rotateSecret(
        tenantId,
        params.id,
        payload.sub,
        body.reason
      );

      webhookLogger.info(
        { webhookId: params.id, tenantId, rotatedBy: payload.sub },
        'Webhook secret rotated'
      );

      // Return the new secret only once
      return reply.send({
        id: params.id,
        secret: result.secret,
        secretPrefix: result.secretPrefix,
        previousSecretPrefix: result.previousSecretPrefix,
        rotatedAt: new Date().toISOString(),
        security: {
          warning: 'Store this secret securely. It will not be shown again.',
          ...getWebhookSecurityDocumentation(),
        },
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: { code: 'WEBHOOK_NOT_FOUND', message: 'Webhook not found' },
        });
      }
      throw error;
    }
  });

  // Test signature verification
  // POST /webhooks/verify-signature - Test signature verification (public endpoint for testing)
  // This helps webhook consumers validate their implementation
  fastify.post('/webhooks/verify-signature', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = webhookVerifySignatureBodySchema.parse(request.body ?? {});

    const isValid = verifyWebhookSignature(
      body.payload,
      body.signature,
      body.secret,
      body.timestamp
    );

    // Also compute what the expected signature should be for debugging
    const now = Math.floor(Date.now() / 1000);
    const timestampAge = now - body.timestamp;
    const isTimestampValid = Math.abs(timestampAge) <= 300; // 5 minutes

    return reply.send({
      valid: isValid,
      details: {
        signatureValid: isValid,
        timestampValid: isTimestampValid,
        timestampAge: timestampAge,
        currentTimestamp: now,
        providedTimestamp: body.timestamp,
      },
      documentation: getWebhookSecurityDocumentation(),
    });
  });

  // Get webhook security documentation
  // GET /webhooks/security-docs - Get documentation for webhook signature verification
  fastify.get('/webhooks/security-docs', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(getWebhookSecurityDocumentation());
  });

  webhookLogger.debug('Webhook routes registered');
}
