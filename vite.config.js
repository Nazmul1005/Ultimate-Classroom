import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(),tailwindcss()],
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true, // Crucial for routing headers correctly
        secure: false,      // Use only if target is not HTTPS
      },
      '/peerjs': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});