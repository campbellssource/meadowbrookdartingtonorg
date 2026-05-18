// @ts-check
import { defineConfig } from 'astro/config';
import keystatic from '@keystatic/astro';
import react from '@astrojs/react';
import markdoc from '@astrojs/markdoc';
import node from '@astrojs/node';

export default defineConfig({
  integrations: [react(), markdoc(), keystatic()],
  output: 'server',
  adapter: node({ mode: 'standalone' }),
});
