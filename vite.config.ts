import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'THE GLOW LAB',
        short_name: 'Glow Lab',
        description:
          'Personal appearance intelligence platform — local-first, offline-capable, private by default.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#08070A',
        theme_color: '#0F0D12',
        orientation: 'any',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{css,js,html,png,svg,woff2,webp}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/discovery/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'glowlab-reference-imagery',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            // Optional external image providers: never required, cached so saved content survives offline.
            urlPattern: ({ url }) =>
              ['images.pexels.com', 'images.unsplash.com', 'pixabay.com', 'cdn.pixabay.com'].includes(
                url.hostname
              ),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'glowlab-external-media',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      }
    })
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
  server: { port: 5177, host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /* These tests drive real IndexedDB and React through jsdom. On the default
      5s a page that takes 3s alone goes over budget when 21 files share the
      CPU, which reads as a failure and is not one. */
    testTimeout: 25000,
    hookTimeout: 25000
  }
} as Parameters<typeof defineConfig>[0] & { test: unknown });
