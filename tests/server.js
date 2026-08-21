// A tiny static file server for tests/fixtures/*.html — the extension's
// content script only matches http(s):// pages, not file://, so tests that
// exercise it need a real (if trivial) HTTP origin to load pages from.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * @param {string} rootDir
 * @returns {Promise<{ url: string, close: () => void }>}
 */
function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const filePath = path.join(rootDir, requestPath === "/" ? "/index.html" : requestPath);

      // Refuse to serve anything outside rootDir.
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403).end("Forbidden");
        return;
      }

      fs.readFile(filePath, (error, data) => {
        if (error) {
          res.writeHead(404).end("Not found");
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        res.end(data);
      });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}

module.exports = { startStaticServer };
