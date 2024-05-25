import { defineConfig } from 'vite'
import { viteSingleFile } from "vite-plugin-singlefile"
import path from 'path';

export default defineConfig({
  base: "/Working-on-Tree/",
  plugins: [viteSingleFile()],
  resolve: {
    alias: {
      src: path.resolve(__dirname, "src/")
    }
  }
});
