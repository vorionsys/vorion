import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Try to load @vitejs/plugin-react; if not available, esbuild handles JSX
let plugins: any[] = []
try {
  const react = require('@vitejs/plugin-react')
  plugins = [react.default ? react.default() : react()]
} catch {
  // @vitejs/plugin-react not resolvable; vitest esbuild handles JSX automatically
}

export default {
  plugins,
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'mcp'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.next/',
        'mcp/',
        '**/*.stories.tsx',
        '**/*.d.ts',
      ],
    },
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
}
