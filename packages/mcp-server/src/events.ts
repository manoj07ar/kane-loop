import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

export function eventsPath(dir: string): string {
  return join(dir, ".kane-loop", "events.jsonl");
}

export async function appendEvent(dir: string, event: Record<string, unknown>): Promise<void> {
  await mkdir(join(dir, ".kane-loop"), { recursive: true });
  await appendFile(eventsPath(dir), JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
}
