/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Racine par défaut en local ; le workflow GitHub Pages passe
// DEPLOY_BASE=/Bot-XAUUSD/ pour servir l'app sous le chemin du repo.
const base = process.env.DEPLOY_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "apple-touch-icon.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
      ],
      manifest: {
        name: "AURUM — Paper Trading XAUUSD",
        short_name: "AURUM",
        description:
          "Bot de paper trading XAUUSD autonome. Prix réels, exécutions simulées.",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        theme_color: "#05070c",
        background_color: "#05070c",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(api\.gold-api\.com|www\.goldapi\.io)\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: "aurum-price-data",
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 10,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
