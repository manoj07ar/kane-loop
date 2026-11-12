import { describe, expect, it } from "vitest";
import { balances, formatEuros, parseEuros, settleUp, splitEvenly } from "../src/split";

describe("splitEvenly", () => {
  it("keeps the total exact when cents don't divide", () => {
    const s = splitEvenly(10000, ["A", "B", "C"]);
    expect([...s.values()]).toEqual([3334, 3333, 3333]);
    expect([...s.values()].reduce((a, b) => a + b)).toBe(10000);
  });
  it("rejects empty or bad input", () => {
    expect(() => splitEvenly(100, [])).toThrow();
    expect(() => splitEvenly(0, ["A"])).toThrow();
  });
});

describe("balances + settleUp", () => {
  it("settles a simple trip", () => {
    const people = ["Ana", "Ben", "Cian"];
    const bal = balances(people, [
      { id: "1", description: "Dinner", amountCents: 9000, paidBy: "Ana", splitAmong: people },
      { id: "2", description: "Taxi", amountCents: 3000, paidBy: "Ben", splitAmong: ["Ben", "Cian"] },
    ]);
    expect(Object.fromEntries(bal)).toEqual({ Ana: 6000, Ben: -1500, Cian: -4500 });
    const t = settleUp(bal);
    expect(t).toEqual([
      { from: "Cian", to: "Ana", amountCents: 4500 },
      { from: "Ben", to: "Ana", amountCents: 1500 },
    ]);
  });
});

describe("money parsing", () => {
  it("parses and formats euros", () => {
    expect(parseEuros("12.5")).toBe(1250);
    expect(parseEuros("€7,05")).toBe(705);
    expect(formatEuros(1250)).toBe("€12.50");
    expect(formatEuros(-5)).toBe("-€0.05");
    expect(() => parseEuros("abc")).toThrow();
  });
});
