/**
 * Webhook Signature Verification Middleware
 *
 * Provides middleware for verifying inbound webhook signatures using HMAC-SHA256.
 * Includes timestamp validation to prevent replay attacks.
 *
 * @packageDocumentation
 */

import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import { createLogger } from '../../common/logger.js';
import { UnauthorizedError } from '../../common/errors.js';
import {
  verifyWebhookSignature,
  verifyWebhookSecretHash,
  SIGNATURE_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
} from '../../intent/webhooks.js';

const logger = createLogger({ component: 'webhook-verify-middleware' });

/**
 * Default timestamp tolerance in seconds (5 minutes)
 */
const DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Configuration for webhook verification
 */
export interface WebhookVerifyConfig {
  /**
   * The webhook secret used for signature verification.
   * Can be a static secret or a function that retrieves the secret
   * based on the request (e.g., from database based on webhook ID).
   */
  secret: string | ((request: FastifyRequest) => Promise<string | null>);

  /**
   * Maximum age of the request in seconds (default: 300 = 5 minutes)
   */
  timestampToleranceSeconds?: number;

  /**
   * Whether to allow requests without signatures (default: false)
   * Use this only for testing or gradual rollout.
   */
  allowUnsigned?: boolean;

  /**
   * Custom error message for invalid signatures
   */
  errorMessage?: string;

  /**
   * Optional callback for logging/metrics on verification failure
   */
  onVerificationFailed?: (request: FastifyRequest, reason: string) => void;
}

/**
 * Webhook verification result
 */
export interface WebhookVerifyResult {
  valid: boolean;
  reason?: string;
  timestamp?: number;
}

/**
 * Extract raw body from request for signature verification.
 *
 * The signature is computed over the raw request body, so we need
 * to preserve the exact bytes that were sent.
 */
function getRawBody(request: FastifyRequest): string | null {
  // Fastify stores raw body if configured with rawBody: true
  // Otherwise, we stringify the parsed body
  const rawBody = (request as unknown as { rawBody?: string | Buffer }).rawBody;
  if (rawBody) {
    return typeof rawBody === 'string'
      ? rawBody
      : rawBody.toString('utf8');
  }

  // Fallback: stringify the parsed body
  // Note: This may not match the original if JSON formatting differs
  if (request.body) {
    return JSON.stringify(request.body);
  }

  return null;
}

/**
 * Verify webhook signature from request headers.
 *
 * @param request - The Fastify request
 * @param secret - The webhook secret
 * @param toleranceSeconds - Maximum age of request in seconds
 * @returns Verification result
 */
export function verifyRequestSignature(
  request: FastifyRequest,
  secret: string,
  toleranceSeconds: number = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS
): WebhookVerifyResult {
  // Extract signature header
  const signatureHeader = request.headers[SIGNATURE_HEADER.toLowerCase()];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  if (!signature) {
    return { valid: false, reason: 'Missing signature header' };
  }

  // Extract timestamp header
  const timestampHeader = request.headers[SIGNATURE_TIMESTAMP_HEADER.toLowerCase()];
  const timestampStr = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;

  if (!timestampStr) {
    return { valid: false, reason: 'Missing timestamp header' };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return { valid: false, reason: 'Invalid timestamp format' };
  }

  // Get raw body for signature verification
  const body = getRawBody(request);
  if (!body) {
    return { valid: false, reason: 'Missing request body' };
  }

  // Verify signature
  const isValid = verifyWebhookSignature(body, signature, secret, timestamp, toleranceSeconds);

  if (!isValid) {
    // Check if timestamp is the issue (for better error messages)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > toleranceSeconds) {
      return {
        valid: false,
        reason: `Timestamp too old or in the future (tolerance: ${toleranceSeconds}s)`,
        timestamp,
      };
    }
    return { valid: false, reason: 'Invalid signature', timestamp };
  }

  return { valid: true, timestamp };
}

/**
 * Create webhook signature verification middleware.
 *
 * This middleware verifies that incoming webhook requests have valid
 * HMAC-SHA256 signatures and timestamps within tolerance.
 *
 * ## Usage
 *
 * ```typescript
 * // Static secret
 * fastify.register(webhookVerifyPlugin, {
 *   secret: process.env.WEBHOOK_SECRET,
 * });
 *
 * // Dynamic secret lookup
 * fastify.register(webhookVerifyPlugin, {
 *   secret: async (request) => {
 *     const webhookId = request.params.id;
 *     const webhook = await getWebhook(webhookId);
 *     return webhook?.secret ?? null;
 *   },
 * });
 * ```
 *
 * @param config - Verification configuration
 * @returns Fastify preHandler hook
 */
export function createWebhookVerifyMiddleware(config: WebhookVerifyConfig) {
  const {
    secret,
    timestampToleranceSeconds = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
    allowUnsigned = false,
    errorMessage = 'Invalid webhook signature',
    onVerificationFailed,
  } = config;

  return async function verifyWebhookSignatureMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Check if signature headers are present
    const hasSignature = !!request.headers[SIGNATURE_HEADER.toLowerCase()];

    if (!hasSignature) {
      if (allowUnsigned) {
        logger.debug(
          { requestId: request.id },
          'Webhook request without signature allowed (allowUnsigned=true)'
        );
        return;
      }

      logger.warn(
        { requestId: request.id },
        'Webhook request rejected: missing signature'
      );

      onVerificationFailed?.(request, 'Missing signature');

      throw new UnauthorizedError(errorMessage, {
        code: 'WEBHOOK_SIGNATURE_MISSING',
        hint: `Include ${SIGNATURE_HEADER} and ${SIGNATURE_TIMESTAMP_HEADER} headers`,
      });
    }

    // Resolve secret
    let resolvedSecret: string | null;
    if (typeof secret === 'function') {
      try {
        resolvedSecret = await secret(request);
      } catch (error) {
        logger.error(
          { requestId: request.id, error },
          'Failed to resolve webhook secret'
        );
        throw new UnauthorizedError(errorMessage, {
          code: 'WEBHOOK_SECRET_RESOLUTION_FAILED',
        });
      }
    } else {
      resolvedSecret = secret;
    }

    if (!resolvedSecret) {
      logger.warn(
        { requestId: request.id },
        'Webhook request rejected: no secret configured'
      );
      onVerificationFailed?.(request, 'No secret configured');
      throw new UnauthorizedError(errorMessage, {
        code: 'WEBHOOK_SECRET_NOT_CONFIGURED',
      });
    }

    // Verify signature
    const result = verifyRequestSignature(request, resolvedSecret, timestampToleranceSeconds);

    if (!result.valid) {
      logger.warn(
        {
          requestId: request.id,
          reason: result.reason,
          timestamp: result.timestamp,
        },
        'Webhook signature verification failed'
      );

      onVerificationFailed?.(request, result.reason ?? 'Unknown');

      throw new UnauthorizedError(errorMessage, {
        code: 'WEBHOOK_SIGNATURE_INVALID',
        reason: result.reason,
      });
    }

    logger.debug(
      { requestId: request.id, timestamp: result.timestamp },
      'Webhook signature verified successfully'
    );
  };
}

/**
 * Fastify plugin for webhook signature verification.
 *
 * Registers the webhook verification middleware as a preHandler hook.
 * Can be scoped to specific routes using Fastify's encapsulation.
 *
 * @example
 * ```typescript
 * // Apply to all routes in a scope
 * fastify.register(async (scope) => {
 *   await scope.register(webhookVerifyPlugin, {
 *     secret: process.env.WEBHOOK_SECRET,
 *   });
 *
 *   scope.post('/webhook', async (request, reply) => {
 *     // Signature already verified
 *     return { received: true };
 *   });
 * });
 * ```
 */
export const webhookVerifyPlugin: FastifyPluginAsync<WebhookVerifyConfig> = async (
  fastify,
  options
) => {
  const middleware = createWebhookVerifyMiddleware(options);
  fastify.addHook('preHandler', middleware);
};

/**
 * Sample code for webhook signature verification.
 *
 * This is returned in API responses to help webhook consumers
 * implement signature verification.
 */
export const WEBHOOK_VERIFICATION_SAMPLE_CODE = {
  nodejs: `
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret, timestamp, toleranceSeconds = 300) {
  // Check timestamp is within tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  // Compute expected signature
  const signedPayload = \`\${timestamp}.\${payload}\`;
  const expectedSignature = 'v1=' + crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// Usage in Express/Node.js
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-vorion-signature'];
  const timestamp = parseInt(req.headers['x-vorion-timestamp'], 10);
  const payload = req.body.toString();

  if (!verifyWebhookSignature(payload, signature, process.env.WEBHOOK_SECRET, timestamp)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process webhook...
  const event = JSON.parse(payload);
  console.log('Received event:', event.eventType);

  res.json({ received: true });
});
`.trim(),

  python: `
import hmac
import hashlib
import time

def verify_webhook_signature(payload: str, signature: str, secret: str, timestamp: int, tolerance_seconds: int = 300) -> bool:
    # Check timestamp is within tolerance
    now = int(time.time())
    if abs(now - timestamp) > tolerance_seconds:
        return False

    # Compute expected signature
    signed_payload = f"{timestamp}.{payload}"
    expected_signature = "v1=" + hmac.new(
        secret.encode(),
        signed_payload.encode(),
        hashlib.sha256
    ).hexdigest()

    # Timing-safe comparison
    return hmac.compare_digest(signature, expected_signature)

# Usage in Flask
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-Vorion-Signature')
    timestamp = int(request.headers.get('X-Vorion-Timestamp', 0))
    payload = request.get_data(as_text=True)

    if not verify_webhook_signature(payload, signature, os.environ['WEBHOOK_SECRET'], timestamp):
        return jsonify({'error': 'Invalid signature'}), 401

    # Process webhook...
    event = request.json
    print(f"Received event: {event['eventType']}")

    return jsonify({'received': True})
`.trim(),

  go: `
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

func verifyWebhookSignature(payload, signature, secret string, timestamp int64, toleranceSeconds int64) bool {
	// Check timestamp is within tolerance
	now := time.Now().Unix()
	if abs(now-timestamp) > toleranceSeconds {
		return false
	}

	// Compute expected signature
	signedPayload := fmt.Sprintf("%d.%s", timestamp, payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signedPayload))
	expectedSignature := "v1=" + hex.EncodeToString(mac.Sum(nil))

	// Timing-safe comparison
	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	signature := r.Header.Get("X-Vorion-Signature")
	timestampStr := r.Header.Get("X-Vorion-Timestamp")
	timestamp, _ := strconv.ParseInt(timestampStr, 10, 64)

	body, _ := io.ReadAll(r.Body)
	payload := string(body)

	if !verifyWebhookSignature(payload, signature, os.Getenv("WEBHOOK_SECRET"), timestamp, 300) {
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	// Process webhook...
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(\`{"received": true}\`))
}
`.trim(),
};

/**
 * Get verification documentation for webhook responses.
 */
export function getWebhookSecurityDocumentation(): {
  headers: { name: string; description: string }[];
  algorithm: string;
  signatureFormat: string;
  verificationSteps: string[];
  sampleCode: typeof WEBHOOK_VERIFICATION_SAMPLE_CODE;
} {
  return {
    headers: [
      {
        name: SIGNATURE_HEADER,
        description: 'HMAC-SHA256 signature in format "v1=<hex-signature>"',
      },
      {
        name: SIGNATURE_TIMESTAMP_HEADER,
        description: 'Unix timestamp (seconds) when the request was generated',
      },
    ],
    algorithm: 'HMAC-SHA256',
    signatureFormat: 'v1=<hex-encoded-hmac>',
    verificationSteps: [
      '1. Extract timestamp from X-Vorion-Timestamp header',
      '2. Verify timestamp is within 5 minutes of current time',
      '3. Construct signed payload: "{timestamp}.{raw-body}"',
      '4. Compute HMAC-SHA256 of signed payload using your webhook secret',
      '5. Compare computed signature with X-Vorion-Signature header (use timing-safe comparison)',
    ],
    sampleCode: WEBHOOK_VERIFICATION_SAMPLE_CODE,
  };
}

export {
  SIGNATURE_HEADER,
  SIGNATURE_TIMESTAMP_HEADER,
} from '../../intent/webhooks.js';
