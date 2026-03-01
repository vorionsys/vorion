import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Force test/development mode BEFORE any React imports
process.env.NODE_ENV = 'test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDepsModules = path.resolve(__dirname, '../../..', 'test-deps/node_modules');
const monorepoModules = path.resolve(__dirname, '../../node_modules');

function resolveFrom(pkg: string): string {
  const test = path.resolve(testDepsModules, pkg);
  const mono = path.resolve(monorepoModules, pkg);
  if (fs.existsSync(test)) return test;
  if (fs.existsSync(mono)) return mono;
  return pkg;
}

// Point directly to development builds of React
const reactDev = path.resolve(resolveFrom('react'), 'cjs/react.development.js');
const reactDomDev = path.resolve(resolveFrom('react-dom'), 'cjs/react-dom-client.development.js');
const reactTestUtilsDev = path.resolve(resolveFrom('react-dom'), 'cjs/react-dom-test-utils.development.js');

export default {
  define: {
    'process.env.NODE_ENV': '"test"',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/components/__tests__/**/*.test.tsx'],
    root: __dirname,
    setupFiles: [],
    testTimeout: 15000,
  },
  resolve: {
    conditions: ['development', 'browser', 'import'],
    alias: {
      '@/': path.resolve(__dirname, 'src') + '/',
      // All React packages from test-deps
      'react': resolveFrom('react'),
      'react-dom': resolveFrom('react-dom'),
      'react/jsx-runtime': resolveFrom('react') + '/jsx-runtime',
      'react/jsx-dev-runtime': resolveFrom('react') + '/jsx-dev-runtime',
      // Force development builds for CJS
      'react-dom/cjs/react-dom-test-utils.production.js': reactTestUtilsDev,
      // Test libraries from test-deps
      '@testing-library/react': resolveFrom('@testing-library/react'),
      '@testing-library/jest-dom': resolveFrom('@testing-library/jest-dom'),
      '@testing-library/dom': resolveFrom('@testing-library/dom'),
    },
  },
};
