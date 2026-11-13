#!/usr/bin/env node
// Loop Console server: serves the built UI and streams .kane-loop/events.jsonl over SSE.
// Usage: node server.mjs [repoDir] [--port 4310]
import { createServer } from "node:http";
import { readFile, stat, open } from "node:fs/promises";
import { watch } from "node:fs";
import { join, extname, resolve, normalize, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT ?? 4310);
const repoDir = resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port") ?? process.env.KANE_LOOP_DIR ?? process.cwd());
const eventsFile = join(repoDir, ".kane-loop", "events.jsonl");
const dist = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jsonl": "application/x-ndjson", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

// Kane screenshots only: image files that resolve (after symlinks) inside the repo dir.
async function artifact(res, p) {
  try {
    if (!p || !IMAGE_EXT.has(extname(p).toLowerCase())) throw new Error("not an image");
    const root = await realpath(repoDir);
    const file = await realpath(resolve(repoDir, p));
    if (file !== root && !file.startsWith(root + sep)) throw new Error("outside repo");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file).toLowerCase()], "cache-control": "no-cache" });
    return res.end(body);
  } catch { res.writeHead(404); return res.end("not found"); }
}

async function size() { try { return (await stat(eventsFile)).size; } catch { return 0; } }
async function readFrom(offset) {
  const end = await size();
  if (end <= offset) return { text: "", end: end < offset ? 0 : offset, reset: end < offset };
  const fh = await open(eventsFile, "r");
  try {
    const buf = Buffer.alloc(end - offset);
    await fh.read(buf, 0, buf.length, offset);
    return { text: buf.toString("utf8"), end, reset: false };
  } finally { await fh.close(); }
}

function sse(req, res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let offset = 0, carry = "", busy = false, closed = false;
  const pump = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const { text, end, reset } = await readFrom(offset);
      if (reset) { carry = ""; offset = 0; res.write("event: reset\ndata: {}\n\n"); }
      else if (text) {
        offset = end;
        const lines = (carry + text).split("\n");
        carry = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) res.write(`data: ${l.trim()}\n\n`);
      }
    } finally { busy = false; }
  };
  pump();
  const timer = setInterval(pump, 500); // polling works even before the file exists
  let watcher;
  try { watcher = watch(join(repoDir, ".kane-loop"), () => pump()); } catch { /* dir not there yet */ }
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => { closed = true; clearInterval(timer); clearInterval(ping); watcher?.close(); });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/events") return sse(req, res);
  if (url.pathname === "/artifact") return artifact(res, url.searchParams.get("path"));
  if (url.pathname === "/events.jsonl") {
    try { res.writeHead(200, { "content-type": types[".jsonl"] }); return res.end(await readFile(eventsFile)); }
    catch { res.writeHead(200, { "content-type": types[".jsonl"] }); return res.end(""); }
  }
  const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(dist, rel);
  if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(port, "127.0.0.1", () => {
  console.log(`Loop Console on http://127.0.0.1:${port}  (watching ${eventsFile})`);
});
