import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Vercel injects env vars at build time. We must explicitly define process.env.API_KEY
    // to replace it with the string value in the client-side bundle.
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  }
});