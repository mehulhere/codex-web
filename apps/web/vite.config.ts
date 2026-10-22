import path from "node:path";
import { defineConfig } from "vitest/config";
import { type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  FARFIELD_CLIENT_ADDRESS_HEADER,
  resolveProxyClientAddress
} from "./src/proxy-network.js";

function createBackendProxy(): ProxyOptions {
  return {
    target: "http://127.0.0.1:4311",
    configure(proxy) {
      proxy.on("proxyReq", (proxyRequest, request) => {
        proxyRequest.setHeader(
          FARFIELD_CLIENT_ADDRESS_HEADER,
          resolveProxyClientAddress(request)
        );
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    host: true,
    allowedHosts: true,
    port: 4312,
    proxy: {
      "/api": createBackendProxy(),
      "/events": createBackendProxy()
    }
  },
  preview: {
    host: true,
    allowedHosts: true,
    port: 4312,
    proxy: {
      "/api": createBackendProxy(),
      "/events": createBackendProxy()
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: []
  }
});
