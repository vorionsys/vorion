#!/usr/bin/env tsx
/**
 * Generate SRI Hashes for Swagger UI Assets
 *
 * This script generates Subresource Integrity (SRI) hashes for the
 * self-hosted Swagger UI assets to be used in the HTML template.
 *
 * Run with: npx tsx scripts/generate-swagger-sri.ts
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_SWAGGER_DIR = join(process.cwd(), 'public', 'swagger');
const SRI_OUTPUT_FILE = join(PUBLIC_SWAGGER_DIR, 'sri-hashes.json');

interface SriHashes {
  css: string;
  bundle: string;
  standalonePreset: string;
  generatedAt: string;
  version: string;
}

function generateSriHash(content: Buffer, algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha384'): string {
  const hash = createHash(algorithm).update(content).digest('base64');
  return `${algorithm}-${hash}`;
}

function main(): void {
  console.log('Generating SRI hashes for Swagger UI assets...\n');

  // Check if files exist
  const files = {
    css: join(PUBLIC_SWAGGER_DIR, 'swagger-ui.css'),
    bundle: join(PUBLIC_SWAGGER_DIR, 'swagger-ui-bundle.js'),
    standalonePreset: join(PUBLIC_SWAGGER_DIR, 'swagger-ui-standalone-preset.js'),
  };

  for (const [name, path] of Object.entries(files)) {
    if (!existsSync(path)) {
      console.error(`Error: ${name} file not found at ${path}`);
      console.error('Run: npm run copy-swagger-assets first');
      process.exit(1);
    }
  }

  // Generate hashes
  const hashes: SriHashes = {
    css: generateSriHash(readFileSync(files.css)),
    bundle: generateSriHash(readFileSync(files.bundle)),
    standalonePreset: generateSriHash(readFileSync(files.standalonePreset)),
    generatedAt: new Date().toISOString(),
    version: getSwaggerUiVersion(),
  };

  // Output hashes
  console.log('SRI Hashes (sha384):');
  console.log('====================');
  console.log(`CSS:               ${hashes.css}`);
  console.log(`Bundle:            ${hashes.bundle}`);
  console.log(`Standalone Preset: ${hashes.standalonePreset}`);
  console.log(`\nGenerated at: ${hashes.generatedAt}`);
  console.log(`Swagger UI version: ${hashes.version}`);

  // Write hashes to JSON file
  writeFileSync(SRI_OUTPUT_FILE, JSON.stringify(hashes, null, 2));
  console.log(`\nHashes written to: ${SRI_OUTPUT_FILE}`);

  // Output TypeScript constant for copy-paste
  console.log('\n\nTypeScript constant for routes.ts:');
  console.log('===================================');
  console.log(`
export const SWAGGER_UI_SRI = {
  css: '${hashes.css}',
  bundle: '${hashes.bundle}',
  standalonePreset: '${hashes.standalonePreset}',
} as const;
`);
}

function getSwaggerUiVersion(): string {
  try {
    const packageJsonPath = join(process.cwd(), 'node_modules', 'swagger-ui-dist', 'package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      return pkg.version || 'unknown';
    }
  } catch {
    // Ignore errors
  }
  return 'unknown';
}

main();
