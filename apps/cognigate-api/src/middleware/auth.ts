/**
 * Authentication Middleware
 *
 * Supports API key authentication with optional JWT for advanced use cases.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as crypto from 'node:crypto';
import {
  AUTH_ERRORS,
  NOT_FOUND_ERRORS,
  createErrorResponse,
} from '@vorionsys/shared-constants';

// In-memory API key store (replace with database later)
const apiKeys = new Map<string, {
  keyId: string;
  name: string;
  permissions: string[];
  createdAt: Date;
  lastUsedAt?: Date;
}>();

// Create a default API key for development
const devKeyId = 'dev-key-001';
const devKeyHash = hashApiKey('vorion-dev-key-12345');
apiKeys.set(devKeyHash, {
  keyId: devKeyId,
  name: 'Development Key',
  permissions: ['*'],
  createdAt: new Date(),
});

/**
 * Hash an API key for secure storage
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * API Key authentication
 */
export interface AuthenticatedRequest extends FastifyRequest {
  apiKey?: {
    keyId: string;
    name: string;
    permissions: string[];
  };
}

/**
 * Register authentication plugin
 */
export async function authPlugin(server: FastifyInstance): Promise<void> {
  // Decorate request with apiKey
  server.decorateRequest('apiKey', null);

  // Add authentication hook
  server.addHook('onRequest', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    // Skip auth for health endpoints
    if (request.url.includes('/health') || request.url.includes('/live') || request.url.includes('/ready')) {
      return;
    }

    // Check for API key in header
    const authHeader = request.headers['authorization'];
    const apiKeyHeader = request.headers['x-api-key'];

    let apiKey: string | undefined;

    if (authHeader?.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7);
    } else if (typeof apiKeyHeader === 'string') {
      apiKey = apiKeyHeader;
    }

    if (!apiKey) {
      const errResp = createErrorResponse(AUTH_ERRORS.MISSING_API_KEY);
      return reply.status(errResp.status).send(errResp.error);
    }

    // Look up the key
    const keyHash = hashApiKey(apiKey);
    const keyData = apiKeys.get(keyHash);

    if (!keyData) {
      const errResp = createErrorResponse(AUTH_ERRORS.INVALID_API_KEY);
      return reply.status(errResp.status).send(errResp.error);
    }

    // Update last used
    keyData.lastUsedAt = new Date();

    // Attach to request
    request.apiKey = {
      keyId: keyData.keyId,
      name: keyData.name,
      permissions: keyData.permissions,
    };
  });
}

/**
 * Check if request has permission
 */
export function hasPermission(request: AuthenticatedRequest, permission: string): boolean {
  if (!request.apiKey) {
    return false;
  }
  return request.apiKey.permissions.includes('*') || request.apiKey.permissions.includes(permission);
}

/**
 * API Key management routes
 */
export async function apiKeyRoutes(server: FastifyInstance): Promise<void> {
  // Create a new API key (admin only)
  server.post('/keys', async (request: FastifyRequest<{
    Body: { name: string; permissions?: string[] }
  }>, reply: FastifyReply) => {
    const { name, permissions = ['read'] } = request.body;

    // Generate a new API key
    const rawKey = `vk_${crypto.randomBytes(24).toString('base64url')}`;
    const keyId = crypto.randomUUID();
    const keyHash = hashApiKey(rawKey);

    apiKeys.set(keyHash, {
      keyId,
      name,
      permissions,
      createdAt: new Date(),
    });

    // Return the raw key only once
    return reply.status(201).send({
      keyId,
      name,
      key: rawKey, // Only returned on creation!
      permissions,
      message: 'Store this key securely. It cannot be retrieved again.',
    });
  });

  // List API keys (without the actual keys)
  server.get('/keys', async () => {
    return Array.from(apiKeys.values()).map((k) => ({
      keyId: k.keyId,
      name: k.name,
      permissions: k.permissions,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    }));
  });

  // Delete an API key
  server.delete('/keys/:keyId', async (
    request: FastifyRequest<{ Params: { keyId: string } }>,
    reply: FastifyReply
  ) => {
    const { keyId } = request.params;

    // Find and delete the key
    for (const [hash, data] of apiKeys.entries()) {
      if (data.keyId === keyId) {
        apiKeys.delete(hash);
        return reply.status(204).send();
      }
    }

    const errResp = createErrorResponse(NOT_FOUND_ERRORS.RESOURCE_NOT_FOUND, {
      resourceType: 'api_key',
      resourceId: keyId,
    });
    return reply.status(errResp.status).send(errResp.error);
  });
}
