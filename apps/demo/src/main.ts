import { balances, formatEuros, parseEuros, settleUp, type Expense } from "./split";

interface State { people: string[]; expenses: Expense[] }
const KEY = "splitly:v1";
const load = (): State => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "") as State; } catch { return { people: [], expenses: [] }; }
};
let state: State = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const li = (text: string, cls?: string) => { const el = document.createElement("li"); el.textContent = text; if (cls) el.className = cls; return el; };
const showError = (msg: string) => { $("error").textContent = msg; };

function render() {
  $("people").replaceChildren(...state.people.map((p) => li(p)));
  const payer = $<HTMLSelectElement>("expense-payer");
  payer.replaceChildren(...state.people.map((p) => { const o = document.createElement("option"); o.value = o.textContent = p; return o; }));
  const fs = $("split-among");
  fs.replaceChildren(fs.querySelector("legend")!, ...state.people.map((p) => {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox"; c.name = "split"; c.value = p; c.checked = true;
    l.append(c, ` ${p}`);
    return l;
  }));
  $("expenses").replaceChildren(...state.expenses.map((e) => li(`${e.description}: ${formatEuros(e.amountCents)} paid by ${e.paidBy}`)));
  $("total").textContent = formatEuros(state.expenses.reduce((s, e) => s + e.amountCents, 0));
  const bal = balances(state.people, state.expenses);
  $("balances").replaceChildren(...[...bal].map(([p, v]) =>
    v > 0 ? li(`${p} is owed ${formatEuros(v)}`, "owed") : v < 0 ? li(`${p} owes ${formatEuros(-v)}`, "owes") : li(`${p} is settled`)));
  $("transfers").replaceChildren();
}

$("person-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const input = $<HTMLInputElement>("person-name");
  const name = input.value.trim();
  if (!name) return showError("Enter a name");
  if (state.people.includes(name)) return showError(`${name} is already added`);
  state.people.push(name); input.value = ""; showError(""); save(); render();
});

$("expense-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const form = ev.target as HTMLFormElement;
  const description = $<HTMLInputElement>("expense-desc").value.trim() || "Expense";
  let amountCents: number;
  try { amountCents = parseEuros($<HTMLInputElement>("expense-amount").value); } catch (e) { return showError((e as Error).message); }
  if (amountCents <= 0) return showError("Amount must be more than zero");
  const paidBy = $<HTMLSelectElement>("expense-payer").value;
  if (!paidBy) return showError("Add people first");
  const splitAmong = [...form.querySelectorAll<HTMLInputElement>("input[name=split]:checked")].map((c) => c.value);
  if (splitAmong.length === 0) return showError("Pick at least one person to split with");
  state.expenses.push({ id: crypto.randomUUID(), description, amountCents, paidBy, splitAmong });
  $<HTMLInputElement>("expense-desc").value = ""; $<HTMLInputElement>("expense-amount").value = "";
  showError(""); save(); render();
});

$("settle-btn").addEventListener("click", () => {
  const t = settleUp(balances(state.people, state.expenses));
  $("transfers").replaceChildren(...(t.length ? t.map((x) => li(`${x.from} pays ${x.to} ${formatEuros(x.amountCents)}`)) : [li("Everyone is settled up")]));
});

$("reset-btn").addEventListener("click", () => { state = { people: [], expenses: [] }; save(); showError(""); render(); });

render();
