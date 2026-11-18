import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { appendEvent } from "./events.js";

export type VerifyStatus = "pass" | "fail" | "not_started" | "timeout" | "error";

export interface KaneStep {
  step: number;
  status: string;
  remark?: string;
}

export interface VerifyInput {
  url: string;
  objective: string;
  name?: string;
  timeout?: number;
}

export interface VerifyResult {
  status: VerifyStatus;
  exit_code: number | null;
  summary?: string;
  one_liner?: string;
  reason?: string;
  failed_step?: number;
  remark?: string;
  test_url?: string;
  session_dir?: string;
  evidence?: string;
  duration?: number;
  credits_consumed?: number;
  /** The *_test.md kane-cli saved for --name (from its recording_state event), replayable for 0 LLM credits. */
  saved_test?: string;
  steps: KaneStep[];
}

export interface RunOptions {
  /** Path to kane-cli. Defaults to env KANE_CLI_BIN, then "kane-cli". */
  bin?: string;
  /** Directory holding .kane-loop/events.jsonl. Defaults to cwd. */
  eventsDir?: string;
  cwd?: string;
}

export const DEFAULT_TIMEOUT = 180;

export function exitCodeToStatus(code: number | null): VerifyStatus {
  switch (code) {
    case 0: return "pass";
    case 1: return "fail";
    case 2: return "not_started";
    case 3: return "timeout";
    default: return "error";
  }
}

export function buildArgs(input: VerifyInput): string[] {
  const args = ["run", input.objective, "--url", input.url, "--agent", "--headless",
    "--timeout", String(input.timeout ?? DEFAULT_TIMEOUT)];
  if (input.name) args.push("--name", input.name);
  return args;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

type Json = Record<string, unknown>;

/**
 * kane-cli 0.10.3 `run --url X --name N` saves N_test.md without a `url:` frontmatter key (the URL only lives in the
 * recorded navigate action). When a replay fails, adaptive heal re-authors the flow and then stops with
 * "No start URL provided", so every later replay of that flow fails for the wrong reason. Pin the start URL.
 * Returns true when the file was changed.
 */
export async function ensureStartUrl(testPath: string, url: string): Promise<boolean> {
  let text: string;
  try { text = await readFile(testPath, "utf8"); } catch { return false; }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (fm && /^url\s*:/m.test(fm[1]!)) return false;
  const line = `url: ${JSON.stringify(url)}`;
  const next = fm ? text.replace(/^---\r?\n/, `---\n${line}\n`) : `---\n${line}\n---\n\n${text}`;
  await writeFile(testPath, next);
  return true;
}

export async function verifyWithKane(input: VerifyInput, opts: RunOptions = {}): Promise<VerifyResult> {
  const bin = opts.bin ?? process.env.KANE_CLI_BIN ?? "kane-cli";
  const eventsDir = opts.eventsDir ?? process.cwd();
  const timeout = input.timeout ?? DEFAULT_TIMEOUT;
  const args = buildArgs({ ...input, name: input.name ? slugify(input.name) || undefined : undefined });
  const steps: KaneStep[] = [];
  let runEnd: Json | undefined;
  let testPath: string | undefined;
  let stderr = "";

  const emit = (event: Json) => appendEvent(eventsDir, { source: "mcp-server", ...event }).catch(() => {});
  await emit({ type: "verify_start", url: input.url, objective: input.objective, name: input.name });

  const handleLine = async (line: string) => {
    const t = line.trim();
    if (!t) return;
    let obj: Json;
    try {
      obj = JSON.parse(t) as Json;
    } catch {
      return; // ignore non-JSON noise
    }
    await emit({ type: "kane_event", event: obj });
    if (obj.type === "recording_state" && obj.persist === true && typeof obj.test_path === "string") testPath = obj.test_path;
    if (obj.type === "run_end" || (runEnd === undefined && "one_liner" in obj && "final_state" in obj)) {
      runEnd = obj;
    } else if (typeof obj.step === "number" && typeof obj.status === "string") {
      steps.push({ step: obj.step, status: obj.status, remark: typeof obj.remark === "string" ? obj.remark : undefined });
    }
  };

  const exitCode = await new Promise<number | null>((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      stderr += String(e);
      resolve(null);
      return;
    }
    let buf = "";
    let chain = Promise.resolve();
    let killed = false;
    const watchdog = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, (timeout + 30) * 1000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        chain = chain.then(() => handleLine(line));
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => { stderr += c; });
    child.on("error", (e) => { stderr += String(e); clearTimeout(watchdog); chain.then(() => resolve(null)); });
    child.on("close", (code) => {
      clearTimeout(watchdog);
      if (buf.trim()) chain = chain.then(() => handleLine(buf));
      chain.then(() => resolve(killed ? 3 : code));
    });
  });

  let status = exitCodeToStatus(exitCode);
  if (testPath && input.name && await ensureStartUrl(testPath, input.url)) {
    await emit({ type: "saved_flow_url_pinned", path: testPath, url: input.url });
  }
  const end = runEnd ?? {};
  const failed = [...steps].reverse().find((s) => /fail|error/i.test(s.status));
  const str = (k: string) => (typeof end[k] === "string" ? (end[k] as string) : undefined);
  const num = (k: string) => (typeof end[k] === "number" ? (end[k] as number) : undefined);

  const result: VerifyResult = {
    status,
    exit_code: exitCode,
    summary: str("summary") ?? (status === "error" ? stderr.trim().slice(0, 500) || undefined : undefined),
    one_liner: str("one_liner"),
    reason: str("reason"),
    failed_step: status === "fail" || status === "timeout" ? failed?.step : undefined,
    remark: status === "fail" || status === "timeout" ? failed?.remark : undefined,
    test_url: str("test_url"),
    session_dir: str("session_dir"),
    evidence: str("session_dir"),
    duration: num("duration"),
    credits_consumed: num("credits_consumed"),
    saved_test: testPath,
    steps,
  };
  await emit({ type: "verify_end", status: result.status, exit_code: exitCode, failed_step: result.failed_step, remark: result.remark, test_url: result.test_url });
  return result;
}
