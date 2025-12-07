import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Vercel injects env vars at build time.
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY),
    // Define process to prevent "process is not defined" error in browser
    'process.env': {} 
  }
});