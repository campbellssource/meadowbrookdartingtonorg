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
  security: {
    // Astro rejects POST form submissions whose Origin is not listed here. With
    // only the production hostnames, every form on the dev server fails with
    // "Cross-site POST form submissions are forbidden" -- which reads like a bug
    // in the form rather than a config restriction.
    //
    // Keyed off argv rather than NODE_ENV: NODE_ENV is unset in the shell here, so
    // relying on it would silently ship localhost as an allowed origin.
    allowedDomains: [
      { hostname: 'meadowbrookdartington.org', protocol: 'https' },
      { hostname: 'www.meadowbrookdartington.org', protocol: 'https' },
      ...(process.argv.includes('dev')
        ? [{ hostname: 'localhost' }, { hostname: '127.0.0.1' }]
        : []),
    ],
  },
  redirects: {
    // Facilities - old top-level URLs → new /facilities/ prefix
    '/snooker-room':         '/facilities/snooker-room',
    '/bike-track':           '/facilities/bike-track',
    '/large-room':           '/facilities/large-room',
    '/muga':                 '/facilities/muga',
    '/pizzalogica':          '/facilities/pizzalogica',
    '/playground':           '/facilities/playground',
    '/playing-fields':       '/facilities/playing-fields',
    '/pool':                 '/facilities/pool',
    '/small-room':           '/facilities/small-room',
    '/somewhere-sauna':      '/facilities/somewhere-sauna',
    '/things-happen-here':   '/facilities/things-happen-here',
    '/totnes-sub-aqua-club': '/facilities/totnes-sub-aqua-club',
    '/woodland-and-brook':   '/facilities/woodland-and-brook',

    // Content pages - old top-level URLs → /content/ prefix
    '/volunteer':    '/content/volunteer',
    '/be-a-trustee': '/content/be-a-trustee',
    '/meadowchat':   '/content/meadowchat',

    // Events - old slug → year-stamped slug
    '/calendar/extravaganza': '/calendar/extravaganza2026',
    '/extravaganza':          '/calendar/extravaganza2026',

    // Privacy policy - maintained in Google Docs
    '/privacy': 'https://docs.google.com/document/d/1V94cmxs0Nix99-eZzGKzUx9z8Bzd0ynNno5waPc0hQQ/edit',
  },
});
