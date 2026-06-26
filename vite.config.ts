import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";

const certPath = process.env.VITE_HTTPS_CERT;
const keyPath = process.env.VITE_HTTPS_KEY;
const hasTrustedCert = !!certPath && !!keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath);
const https =
  process.env.VITE_HTTPS === "true"
    ? hasTrustedCert
      ? { cert: fs.readFileSync(certPath!), key: fs.readFileSync(keyPath!) }
      : true
    : undefined;
const strictPort = process.env.VITE_STRICT_PORT === "true";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    strictPort,
    https,
  },
  preview: {
    port: 5177,
    strictPort,
    https,
  },
});
