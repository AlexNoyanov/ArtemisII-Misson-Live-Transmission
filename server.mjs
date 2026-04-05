import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLiveOrbitPayload } from "./lib/telemetry-live.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}
loadLocalEnv();
const PUBLIC = path.join(__dirname, "public");
const PREFERRED_PORT = Number(process.env.PORT) || 3000;
const PORT_ATTEMPTS = 50;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function proxyHorizons(search) {
  const target = `https://ssd.jpl.nasa.gov/api/horizons.api${search}`;
  const r = await fetch(target, { headers: { Accept: "application/json" } });
  const text = await r.text();
  return { status: r.status, text };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/telemetry") {
    try {
      const payload = await fetchLiveOrbitPayload();
      send(res, 200, JSON.stringify(payload), {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=5",
      });
    } catch (e) {
      send(
        res,
        502,
        JSON.stringify({ error: String(e.message) }),
        { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      );
    }
    return;
  }

  if (url.pathname === "/api/horizons") {
    try {
      const q = url.search || "";
      const { status, text } = await proxyHorizons(q);
      send(res, status, text, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=30",
      });
    } catch (e) {
      send(
        res,
        502,
        JSON.stringify({ error: "Horizons proxy failed", detail: String(e.message) }),
        { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      );
    }
    return;
  }

  let filePath = path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(PUBLIC)) {
    send(res, 403, "Forbidden");
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath);
  send(res, 200, fs.readFileSync(filePath), { "Content-Type": MIME[ext] || "application/octet-stream" });
});

function listenWithFallback(server, startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    const tryPort = () => {
      const onError = (err) => {
        server.off("error", onError);
        if (err.code === "EADDRINUSE" && port - startPort < PORT_ATTEMPTS) {
          port += 1;
          tryPort();
        } else {
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(port, () => {
        server.off("error", onError);
        resolve(port);
      });
    };
    tryPort();
  });
}

listenWithFallback(server, PREFERRED_PORT)
  .then((port) => {
    if (port !== PREFERRED_PORT) {
      console.warn(`Port ${PREFERRED_PORT} in use; using ${port} instead.`);
    }
    console.log(`Artemis II dashboard: http://localhost:${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
