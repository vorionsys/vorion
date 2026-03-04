import { defineConfig, type Plugin } from 'vitest/config';
import path from 'path';
import fs from 'fs';

const platformCore = './packages/platform-core/src';

/**
 * Vite plugin to resolve .js imports to .ts files.
 *
 * Handles two challenges:
 * 1. TypeScript NodeNext module resolution uses .js extensions in imports
 * 2. On Windows, git symlinks in src/ (common, intent, security, etc.) are stored
 *    as text files, breaking directory resolution. Falls back to packages/platform-core/src/.
 */
function resolveJsToTs(): Plugin {
  const srcDir = path.resolve(__dirname, 'src');
  const securitySrcDir = path.resolve(__dirname, 'packages/security/src');
  const platformSrcDir = path.resolve(__dirname, 'packages/platform-core/src');

  // Fallback directories for broken Windows symlinks under src/
  const fallbackDirs = [platformSrcDir, securitySrcDir];

  /**
   * On Windows, git symlinks in src/ are stored as text files containing the
   * target path. This function reads those text files and resolves the actual
   * target directory.
   */
  function readSymlinkText(filePath: string): string | null {
    try {
      const stat = fs.statSync(filePath);
      // Text-file symlinks are small regular files (< 200 bytes)
      if (stat.isFile() && stat.size < 200) {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content.startsWith('.') || content.startsWith('/')) {
          const resolved = path.resolve(path.dirname(filePath), content);
          try {
            if (fs.statSync(resolved).isDirectory() || fs.existsSync(resolved)) {
              return resolved;
            }
          } catch { /* target doesn't exist */ }
        }
      }
    } catch { /* file doesn't exist */ }
    return null;
  }

  return {
    name: 'resolve-js-to-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || source.includes('node_modules') || !source.startsWith('.')) {
        return null;
      }

      const importerDir = path.dirname(importer);
      const resolvedSource = path.resolve(importerDir, source);

      // Handle .js → .ts resolution
      if (source.endsWith('.js')) {
        const tsPath = resolvedSource.replace(/\.js$/, '.ts');

        // Try direct .ts resolution
        try {
          const dir = path.dirname(tsPath);
          if (fs.statSync(dir).isDirectory() && fs.existsSync(tsPath)) {
            return tsPath;
          }
        } catch { /* fall through */ }

        // Check if parent dir is a text-file symlink
        const parentDir = path.dirname(tsPath);
        const parentName = path.dirname(resolvedSource);
        const symlinkTarget = readSymlinkText(parentName);
        if (symlinkTarget) {
          const targetTs = path.resolve(symlinkTarget, path.basename(tsPath));
          if (fs.existsSync(targetTs)) {
            return targetTs;
          }
        }

        // Fallback: if path falls under src/, try package directories
        const normalizedTsPath = tsPath.replace(/\\/g, '/');
        const normalizedSrcDir = srcDir.replace(/\\/g, '/');
        if (normalizedTsPath.startsWith(normalizedSrcDir + '/')) {
          const relativePath = path.relative(srcDir, tsPath);
          for (const fallbackDir of fallbackDirs) {
            const fallbackPath = path.resolve(fallbackDir, relativePath);
            if (fs.existsSync(fallbackPath)) {
              return fallbackPath;
            }
          }
        }
      }

      // Handle text-file symlinks for directory-level imports (e.g. ../../aci-extensions/index.js)
      // Check if any path segment is a text-file symlink
      const normalized = resolvedSource.replace(/\\/g, '/');
      const normalizedSrc = srcDir.replace(/\\/g, '/');
      if (normalized.startsWith(normalizedSrc + '/')) {
        const afterSrc = normalized.slice(normalizedSrc.length + 1);
        const segments = afterSrc.split('/');
        // Check first segment — might be a text-file symlink
        const firstSegPath = path.resolve(srcDir, segments[0]!);
        const target = readSymlinkText(firstSegPath);
        if (target) {
          const rest = segments.slice(1).join('/');
          let targetPath = path.resolve(target, rest);
          // Try .ts extension if .js
          if (targetPath.endsWith('.js')) {
            const tsVariant = targetPath.replace(/\.js$/, '.ts');
            if (fs.existsSync(tsVariant)) return tsVariant;
          }
          if (fs.existsSync(targetPath)) return targetPath;
        }
      }

      return null;
    },
  };
}

/**
 * Vite plugin to resolve `@/` path aliases for Next.js apps in the monorepo.
 *
 * Each app uses `@/` to mean its own root (aurais → src/, agentanchor → ./).
 * Since the root vitest config runs all tests, we detect which app the importer
 * belongs to and resolve accordingly.
 */
function resolveAppAtAlias(): Plugin {
  const appRoots: [string, string][] = [
    ['apps/aurais/', path.resolve(__dirname, 'apps/aurais/src')],
    ['apps/agentanchor/', path.resolve(__dirname, 'apps/agentanchor')],
    ['apps/kaizen/', path.resolve(__dirname, 'apps/kaizen/src')],
  ];

  return {
    name: 'resolve-app-at-alias',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('@/')) return null;

      const normalizedImporter = importer.replace(/\\/g, '/');
      for (const [appPrefix, aliasTarget] of appRoots) {
        if (normalizedImporter.includes(`/${appPrefix}`) || normalizedImporter.includes(`\\${appPrefix.replace(/\//g, '\\')}`)) {
          const relative = source.slice(2); // strip '@/'
          const base = path.resolve(aliasTarget, relative);

          // Try .ts, .tsx, /index.ts, /index.tsx, then as-is
          for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
            const candidate = base + ext;
            if (fs.existsSync(candidate)) return candidate;
          }
          return null;
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveJsToTs(), resolveAppAtAlias()],
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'packages/**/__tests__/**/*.test.ts', 'apps/**/tests/**/*.test.ts', 'apps/**/__tests__/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      // Kaizen React tests need their own config (separate React resolution)
      'apps/kaizen/**/__tests__/**',
      // Infrastructure-dependent tests require PostgreSQL + Redis
      // Run separately with: npx vitest run --config vitest.config.infra.ts
      'tests/integration/api/authorization.test.ts',
      'tests/integration/api/escalations.test.ts',
      'tests/integration/api/gdpr.test.ts',
      'tests/integration/api/intents.test.ts',
      'tests/integration/api/policies.test.ts',
    ],
    setupFiles: ['./tests/vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    testTimeout: 15000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: [
      // Map @vorion/* to packages/platform-core/src for monorepo structure
      { find: '@vorion/basis', replacement: path.resolve(__dirname, platformCore, 'basis') },
      { find: '@vorion/cognigate', replacement: path.resolve(__dirname, platformCore, 'cognigate') },
      { find: '@vorion/enforce', replacement: path.resolve(__dirname, platformCore, 'enforce') },
      { find: '@vorion/intent', replacement: path.resolve(__dirname, platformCore, 'intent') },
      { find: '@vorion/proof', replacement: path.resolve(__dirname, platformCore, 'proof') },
      { find: '@vorion/trust-engine', replacement: path.resolve(__dirname, platformCore, 'trust-engine') },
      { find: '@vorion/api', replacement: path.resolve(__dirname, platformCore, 'api') },
      { find: '@vorion/common', replacement: path.resolve(__dirname, platformCore, 'common') },
      { find: '@vorion/security', replacement: path.resolve(__dirname, platformCore, 'security') },
      { find: '@vorion/audit', replacement: path.resolve(__dirname, platformCore, 'audit') },
      { find: '@vorion/contracts', replacement: path.resolve(__dirname, './packages/contracts/src') },
      // Map @vorionsys/contracts subpaths to local contracts package
      { find: '@vorionsys/contracts/db', replacement: path.resolve(__dirname, './packages/contracts/src/db') },
      { find: '@vorionsys/contracts', replacement: path.resolve(__dirname, './packages/contracts/src') },
    ],
  },
});
