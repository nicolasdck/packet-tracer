/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The new version waits until the user taps "Refresh app" (see UpdateBanner).
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Mini Packet Tracer',
        short_name: 'Packet Tracer',
        description: 'Offline Cisco IOS network simulator',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Full-bleed versions: without them Android puts the icon on a white plate.
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Source artwork (not used by the app), and the Python runtime: 13 MB is
        // too much to download at install, it is cached on first use instead.
        globIgnores: ['**/logo.png', '**/pyodide/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/pyodide/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pyodide', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  // The Python worker loads modules dynamically.
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
