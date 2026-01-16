import { defineConfig } from "vite";
import react from "@vite/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/Bunpu/",
  worker: {
    format: "es",
  },
});
