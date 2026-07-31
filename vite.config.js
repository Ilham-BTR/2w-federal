import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    react(),
    basicSsl()  // self-signed HTTPS cert — biar GPS jalan di HP (geolocation butuh secure context)
  ],
  server: {
    port: 5173,
    open: true,
    host: true  // expose ke network — bisa diakses dari HP di WiFi yang sama
  }
});
