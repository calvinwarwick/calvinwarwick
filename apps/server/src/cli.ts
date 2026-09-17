import { runHeadless } from "./live.js";

const args = process.argv.slice(2);
const get = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};

const hands = Number(get("--hands", "200"));
const seed = Number(get("--seed", "42"));
const mode = get("--mode", "baseline") as "baseline" | "exploitative";
const name = get("--name", `${mode}-${hands}`);

console.log(`Running headless ${mode} experiment: ${hands} hands, seed ${seed}`);
const result = runHeadless({ name, mode, hands, seed, accuracy: "fast" });
const u = result.analytics.uncertainty;
console.log(`Hands: ${result.handsPlayed}`);
console.log(`Observed BB/100: ${u.observedWinrateBb100.toFixed(2)}`);
console.log(`EV BB/100: ${u.evWinrateBb100.toFixed(2)}`);
console.log(`95% CI: [${u.ci95[0].toFixed(2)}, ${u.ci95[1].toFixed(2)}]`);
console.log(u.note);
