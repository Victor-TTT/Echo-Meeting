import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Safely inject the API Key. If it's missing in Vercel, it defaults to an empty string.
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY || ""),
  }
});