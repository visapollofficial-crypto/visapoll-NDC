import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep Firebase in its own cacheable chunk (helps slow networks).
        manualChunks: { firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/functions", "firebase/storage", "firebase/messaging"] },
      },
    },
  },
});
