export interface Expense {
  id: string;
  description: string;
  amountCents: number;
  paidBy: string;
  splitAmong: string[];
}

export interface Transfer {
  from: string;
  to: string;
  amountCents: number;
}

/** Split an amount in cents evenly; the first participants absorb leftover cents so the total always matches. */
export function splitEvenly(amountCents: number, people: string[]): Map<string, number> {
  if (people.length === 0) throw new Error("Split needs at least one person");
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Amount must be a positive whole number of cents");
  const base = Math.floor(amountCents / people.length);
  let remainder = amountCents - base * people.length;
  const shares = new Map<string, number>();
  for (const p of people) {
    shares.set(p, base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return shares;
}

/** Net balance per person: positive means they are owed money. */
export function balances(people: string[], expenses: Expense[]): Map<string, number> {
  const bal = new Map<string, number>(people.map((p) => [p, 0]));
  for (const e of expenses) {
    bal.set(e.paidBy, (bal.get(e.paidBy) ?? 0) + e.amountCents);
    for (const [p, share] of splitEvenly(e.amountCents, e.splitAmong)) {
      bal.set(p, (bal.get(p) ?? 0) - share);
    }
  }
  return bal;
}

/** Greedy settle-up: fewest obvious transfers from debtors to creditors. */
export function settleUp(bal: Map<string, number>): Transfer[] {
  const debtors = [...bal].filter(([, v]) => v < 0).map(([p, v]) => ({ p, v: -v })).sort((a, b) => b.v - a.v);
  const creditors = [...bal].filter(([, v]) => v > 0).map(([p, v]) => ({ p, v })).sort((a, b) => b.v - a.v);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    if (amt > 0) out.push({ from: debtors[i].p, to: creditors[j].p, amountCents: amt });
    debtors[i].v -= amt;
    creditors[j].v -= amt;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return out;
}

export function parseEuros(input: string): number {
  const cleaned = input.trim().replace(/^€/, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error("Enter an amount like 12.50");
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatEuros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}€${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
