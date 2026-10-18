import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const port = Number(arg("--port") ?? 4173);
const host = arg("--host") ?? "127.0.0.1";
const base = "/english-diary-review";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const publicFiles = new Set([
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "sw.js",
  "src/app.js",
  "src/core.js",
  "src/db.js",
  "src/views.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
]);
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === base) {
      response.writeHead(301, { Location: `${base}/` });
      response.end();
      return;
    }
    let relative = decodeURIComponent(url.pathname);
    if (relative.startsWith(`${base}/`)) relative = relative.slice(base.length);
    relative = relative.replace(/^\//, "") || "index.html";
    // Never serve local databases, private JSON, test artifacts or .git files.
    if (
      !["GET", "HEAD"].includes(request.method) ||
      !publicFiles.has(relative)
    ) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const file = path.resolve(root, relative);
    if (!(await stat(file)).isFile()) throw new Error("Not found");
    response.writeHead(200, {
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(request.method === "HEAD" ? undefined : await readFile(file));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
server.listen(port, host, () =>
  console.log(
    `Static development server listening on port ${port} (GitHub Pages subpath supported)`,
  ),
);
