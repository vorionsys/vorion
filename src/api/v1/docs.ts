/**
 * API v1 Documentation Routes
 *
 * @packageDocumentation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../../common/logger.js';
import { getOpenApiSpec, getOpenApiSpecJson } from '../../intent/openapi.js';
import { API_VERSIONS, CURRENT_VERSION } from '../versioning/index.js';

const docsLogger = createLogger({ component: 'api-v1-docs' });

/**
 * Register v1 documentation routes
 */
export async function registerDocsRoutesV1(fastify: FastifyInstance): Promise<void> {
  // OpenAPI specification
  fastify.get('/openapi.json', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header('Content-Type', 'application/json')
      .send(getOpenApiSpecJson());
  });

  // Swagger UI
  fastify.get('/docs', async (_request: FastifyRequest, reply: FastifyReply) => {
    const specUrl = '/api/v1/openapi.json';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vorion API v1 Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
    .version-banner {
      background: #1976d2;
      color: white;
      padding: 10px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
    }
    .version-banner strong { margin-right: 10px; }
    .version-badge {
      background: rgba(255,255,255,0.2);
      padding: 4px 8px;
      border-radius: 4px;
      margin-left: 8px;
    }
  </style>
</head>
<body>
  <div class="version-banner">
    <strong>API Version:</strong> ${CURRENT_VERSION}
    <span class="version-badge">Current</span>
    <span style="margin-left: 20px;">Available versions: ${API_VERSIONS.join(', ')}</span>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        persistAuthorization: true,
        withCredentials: true
      });
    };
  </script>
</body>
</html>`;

    return reply
      .header('Content-Type', 'text/html')
      .send(html);
  });

  // API versions endpoint
  fastify.get('/versions', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      current: CURRENT_VERSION,
      supported: API_VERSIONS,
      deprecated: [],
    });
  });

  docsLogger.debug('Documentation routes registered');
}
