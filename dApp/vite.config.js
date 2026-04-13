import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
    // consenti l’host pubblico di ngrok
    allowedHosts: [
      'repercussively-runtgenologic-jesica.ngrok-free.dev',
      '.ngrok-free.dev',          // opzionale: per future sessioni (se supportato)
    ],
    // HMR dietro HTTPS/tunnel
    hmr: {
      protocol: 'wss',
      host: 'repercussively-runtgenologic-jesica.ngrok-free.dev',
      clientPort: 443,
    },
  },
})
