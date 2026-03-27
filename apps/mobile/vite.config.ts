import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL ?? 'https://mmel-dispatch-advisor.azurewebsites.net',
        changeOrigin: true,
      }
    }
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    }
  }
});

