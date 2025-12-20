import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Optimized for Tauri desktop application
export default defineConfig({
  plugins: [tailwindcss(), react()],
  
  // Tauri expects a fixed port
  server: {
    port: 3001,
    strictPort: true,
    // Tauri uses its own dev server, so we need to allow it
    host: true,
  },

  // Optimize for Tauri
  clearScreen: false,
  
  // Environment variables with TAURI_ prefix are exposed
  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    // Tauri uses Chromium on Windows/Linux and WebKit on macOS
    // Target modern browsers only (no IE11, etc.)
    target: ['es2021', 'chrome100', 'safari15'],
    
    // Don't minify for debug builds (faster builds during dev)
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,

    // Optimize chunk size
    rollupOptions: {
      output: {
        // Split vendor chunks for better caching
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'chart-vendor': ['chart.js', 'chartjs-chart-financial', 'chartjs-plugin-annotation', 'chartjs-plugin-zoom', 'chartjs-adapter-date-fns'],
        },
      },
    },

    // Increase chunk size warning limit (Chart.js is large)
    chunkSizeWarningLimit: 600,
  },
})
