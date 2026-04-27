import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");

/** Dev-time middleware: serves repo's `data/` directory at `/data/*`. */
function dataFilesPlugin() {
  return {
    name: "maxdash-data-files",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const m = req.url.match(/^\/data\/([^?#]+)/);
        if (!m) return next();
        try {
          const buf = await readFile(path.join(dataDir, decodeURIComponent(m[1])));
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(buf);
        } catch {
          res.statusCode = 404;
          res.end("not found");
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), dataFilesPlugin()],
  base: command === "build" ? "/maxdash/" : "/",
}));
