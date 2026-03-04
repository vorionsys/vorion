/**
 * Astro Configuration for BAI-CC Public Dashboard
 *
 * Vorion Satellite Pattern: Edge-deployed public dashboard
 * using Cloudflare Pages + Workers + KV
 */
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://bai-cc.com',
  output: 'server', // SSR pages read KV directly; static pages opt-in with prerender = true
  adapter: cloudflare({
    imageService: 'cloudflare',
    platformProxy: {
      enabled: true,
    },
  }),
  integrations: [],
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ['@neondatabase/serverless'],
    },
  },
});
