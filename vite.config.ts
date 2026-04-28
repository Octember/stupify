import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "react-router"],
    tsconfigPaths: true,
  },
  server: {
    strictPort: true,
  },
  preview: {
    strictPort: true,
  },
});
