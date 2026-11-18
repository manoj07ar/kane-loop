import "./style.css";
import { buildTimeline, parseJsonl, screenshotUrl, type Json, type Run, type Timeline } from "./timeline";

const events: Json[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, kids: Node[] = []): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text; // textContent only: Kane remarks are untrusted text
  for (const k of kids) n.append(k);
  return n;
}

const time = (ts?: string) => (ts ? new Date(ts).toLocaleTimeString() : "");
const secs = (a?: string, b?: string) => (a && b ? `${((Date.parse(b) - Date.parse(a)) / 1000).toFixed(1)}s` : "");

function runCard(r: Run): HTMLElement {
  const head = el("div", "head", undefined, [
    el("span", undefined, `${r.kind === "replay" ? "↻" : "▶"} ${r.label}`),
    el("span", `tag ${r.status}`, `${r.status}${r.end ? ` · ${secs(r.start, r.end)}` : ""}`),
  ]);
  const card = el("div", "run", undefined, [head]);
  if (r.steps.length) card.append(el("div", "steps", undefined, r.steps.map((s) => el("span", `step ${s.status.toLowerCase()}`, `${s.step} ${s.status}`))));
  const remark = r.remark ?? r.failed?.map((f) => [f.path, f.message].filter(Boolean).join(": ")).join("; ");
  if (remark && r.status !== "pass") card.append(el("div", "remark", `Kane says${r.failed_step !== undefined ? ` (step ${r.failed_step})` : ""}: ${remark}`));
  if (r.test_url && /^https?:\/\//.test(r.test_url)) {
    const a = el("a", undefined, "evidence in Test Manager");
    a.href = r.test_url; a.target = "_blank"; a.rel = "noopener";
    card.append(el("div", "muted", undefined, [a]));
  }
  return card;
}

function render(t: Timeline) {
  const badge = document.getElementById("badge")!;
  badge.className = `badge ${t.state}`;
  badge.textContent = t.state.replace("_", " ");
  const red = t.iterations.filter((i) => i.result === "red").length;
  document.getElementById("stats")!.replaceChildren(
    ...[["Kane runs", t.passes + t.fails], ["passed", t.passes], ["failed", t.fails], ["red turns", red], ["loop turns", t.iterations.length]]
      .map(([k, v]) => el("div", "stat", undefined, [el("b", undefined, String(v)), el("span", "muted", String(k))])),
  );
  const root = document.getElementById("timeline")!;
  const blocks: HTMLElement[] = [];
  t.iterations.forEach((it, idx) => {
    const title = it.result === "green" ? "Agent turn ended: all flows green" : it.result === "red" ? `Red, iteration ${it.iteration}: failure sent back to the agent` : `Loop stopped (${it.reason ?? it.result})`;
    const box = el("div", `iter ${it.result}`, undefined, [
      el("h2", undefined, undefined, [el("span", "muted", `#${idx + 1} ${time(it.ts)}`), el("span", undefined, title), it.source ? el("span", "tag idle", it.source) : document.createTextNode("")]),
      ...it.runs.map(runCard),
    ]);
    for (const f of it.failed) {
      const where = f.path ?? f.objective ?? "flow";
      box.append(el("div", "remark", `→ agent told: ${where}${f.failed_step !== undefined ? ` step ${String(f.failed_step)}` : ""}${f.heading ? ` (${String(f.heading)})` : ""}: ${String(f.remark ?? "")}`));
      const shot = screenshotUrl(f.screenshot, replayMode);
      if (shot) {
        const img = el("img", "shot");
        img.src = shot; img.alt = `Kane screenshot at the failing step of ${where}`; img.loading = "lazy";
        img.onerror = () => img.replaceWith(el("div", "muted", `screenshot not available: ${String(f.screenshot)}`));
        box.append(img);
      }
    }
    blocks.push(box);
  });
  if (t.pending.length) blocks.push(el("div", "iter verifying", undefined, [el("h2", undefined, "In progress"), ...t.pending.map(runCard)]));
  if (!blocks.length) blocks.push(el("p", "muted", "No events yet. Run verify_with_kane or finish an agent turn with the stop hook installed."));
  root.replaceChildren(...blocks.reverse()); // newest first
}

const params = new URLSearchParams(location.search);
const replay = params.get("replay");
const replayMode = replay !== null;
const refresh = () => render(buildTimeline(events));
const source = document.getElementById("source")!;

if (replay !== null) {
  // Read-only replay of a recorded events.jsonl, so judges see a full loop without credentials.
  const url = replay || "sample-loop.jsonl";
  const speed = Number(params.get("speed") ?? 8);
  source.textContent = `Replaying ${url} at ${speed}x${replay ? "" : " (a real recorded Kane CLI loop, 18 Nov 2026)"}`;
  fetch(url).then((r) => r.text()).then(async (text) => {
    const all = parseJsonl(text);
    for (let i = 0; i < all.length; i++) {
      events.push(all[i]);
      refresh();
      const gap = i + 1 < all.length ? Date.parse(String(all[i + 1].ts)) - Date.parse(String(all[i].ts)) : 0;
      await new Promise((res) => setTimeout(res, Math.min(Math.max(gap / speed, 40), 1500)));
    }
    source.textContent = `Replayed ${url} (${all.length} events)`;
  }).catch((e) => { source.textContent = `Could not load ${url}: ${e}`; });
} else {
  source.textContent = "Live: streaming .kane-loop/events.jsonl";
  const es = new EventSource("/events");
  es.onmessage = (m) => { try { events.push(JSON.parse(m.data)); refresh(); } catch { /* skip */ } };
  es.addEventListener("reset", () => { events.length = 0; refresh(); });
  es.onerror = () => { source.textContent = "Live stream disconnected, retrying…"; };
  es.onopen = () => { source.textContent = "Live: streaming .kane-loop/events.jsonl"; };
}
refresh();
