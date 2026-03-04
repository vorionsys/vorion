import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://bai-cc.com',
  adapter: vercel({
    maxDuration: 30,
  }),
  vite: {
    plugins: [tailwindcss()],
  },
});
