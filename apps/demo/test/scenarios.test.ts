import { describe, expect, it } from "vitest";
import { balances, settleUp } from "../src/split";

// Mirrors the strings the splitly-even-split flow in .kane-loop.json expects Kane to read.
describe("splitly-even-split flow expectations", () => {
  it("€10 between Ana, Ben and Cara, paid by Ana", () => {
    const e = [{ id: "1", description: "Taxi", amountCents: 1000, paidBy: "Ana", splitAmong: ["Ana", "Ben", "Cara"] }];
    const bal = balances(["Ana", "Ben", "Cara"], e);
    expect([...bal]).toEqual([["Ana", 666], ["Ben", -333], ["Cara", -333]]);
    expect(settleUp(bal)).toEqual([
      { from: "Ben", to: "Ana", amountCents: 333 },
      { from: "Cara", to: "Ana", amountCents: 333 },
    ]);
  });
});
