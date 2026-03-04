import { defineConfig } from 'vite';
import path from 'path';

// All dependencies resolve from root monorepo node_modules
const rootNodeModules = path.resolve(__dirname, '../../node_modules');

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"development"',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
  resolve: {
    // Use development conditions so React.act is available
    conditions: ['development', 'browser', 'default'],
    alias: {
      // All testing libraries from root node_modules
      '@testing-library/react': path.join(rootNodeModules, '@testing-library/react'),
      '@testing-library/jest-dom': path.join(rootNodeModules, '@testing-library/jest-dom'),
      '@testing-library/dom': path.join(rootNodeModules, '@testing-library/dom'),
      // Force all react/react-dom imports to single copies (prevent dual React)
      'react-dom/test-utils': path.join(rootNodeModules, 'react-dom/test-utils'),
      'react-dom/client': path.join(rootNodeModules, 'react-dom/client'),
      'react-dom': path.join(rootNodeModules, 'react-dom'),
      'react/jsx-runtime': path.join(rootNodeModules, 'react/jsx-runtime'),
      'react/jsx-dev-runtime': path.join(rootNodeModules, 'react/jsx-dev-runtime'),
      'react': path.join(rootNodeModules, 'react'),
    },
  },
} as any);
