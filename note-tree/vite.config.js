import { defineConfig } from 'vite'
import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig({
  base: "/Working-on-Tree/",
  plugins: [viteSingleFile()],
});
