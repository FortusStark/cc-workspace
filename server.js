const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json"
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function proxyJson(req, res, options) {
  const raw = await readBody(req);
  const body = raw ? JSON.parse(raw) : {};
  const upstream = await fetch(options.url, {
    method: "POST",
    headers: options.headers,
    body: JSON.stringify(body)
  });
  const text = await upstream.text();
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function serveFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  fs.createReadStream(filePath)
    .on("error", () => sendJson(res, 404, { ok: false, error: "Not found" }))
    .once("open", () => {
      res.writeHead(200, { "Content-Type": type });
    })
    .pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/provider/openrouter") {
      if (!process.env.OPENROUTER_API_KEY) {
        return sendJson(res, 500, { ok: false, error: { message: "OPENROUTER_API_KEY is not configured" } });
      }
      return proxyJson(req, res, {
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": process.env.PUBLIC_APP_URL || "https://commandcenter.local",
          "X-Title": "Command Center"
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/provider/anthropic") {
      if (!process.env.ANTHROPIC_API_KEY) {
        return sendJson(res, 500, { ok: false, error: { message: "ANTHROPIC_API_KEY is not configured" } });
      }
      return proxyJson(req, res, {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/provider/google") {
      if (!process.env.GOOGLE_API_KEY) {
        return sendJson(res, 500, { ok: false, error: { message: "GOOGLE_API_KEY is not configured" } });
      }
      return proxyJson(req, res, {
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GOOGLE_API_KEY}`,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(ROOT, safePath);
    if (!filePath.startsWith(ROOT)) {
      return sendJson(res, 403, { ok: false, error: "Forbidden" });
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveFile(req, res, filePath);
    }
    return serveFile(req, res, path.join(ROOT, "index.html"));
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: { message: error.message } });
  }
});

server.listen(PORT, () => {
  console.log(`Command Center listening on ${PORT}`);
});
