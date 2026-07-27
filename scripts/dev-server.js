// Lokaler Dev-Server NUR zum Testen: bedient die statischen Dateien UND die /api-Functions,
// ohne dass dafuer die Vercel CLI/ein Vercel-Account noetig ist. Fuer den echten Produktivbetrieb
// gilt weiterhin die Vercel-Deployment-Anleitung in README.md.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

function loadEnv(file) {
  const full = path.join(__dirname, "..", file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  }
}
loadEnv(".env");

const estatesHandler = require("../api/estates");
const leadHandler = require("../api/lead");

const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function enhanceResponse(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (obj) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  enhanceResponse(res);
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/estates") {
    req.query = Object.fromEntries(url.searchParams);
    return estatesHandler(req, res);
  }

  if (url.pathname === "/api/lead") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        req.body = body ? JSON.parse(body) : {};
      } catch (e) {
        req.body = {};
      }
      await leadHandler(req, res);
    });
    return;
  }

  const filePath = path.join(ROOT, url.pathname === "/" ? "/index.html" : url.pathname);
  if (!filePath.startsWith(ROOT)) {
    res.status(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.status(404).end("Not found");
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
    res.end(data);
  });
});

const PORT = process.env.PORT || 4174;
server.listen(PORT, () => console.log(`Dev-Server (mit /api) läuft auf http://localhost:${PORT}`));
