# Poker Lab — NLHE Research Simulation

Offline research laboratory for **No-Limit Texas Hold’em** cash-game decision-making, modelled on online **$0.10/$0.25 NLHE 6-max** (“NL25”).

This project **does not** connect to GGPoker or any poker client, scrape private game state, automate mouse/keyboard input, or play real-money games. The agent receives structured game state and returns a legal action.

## Architecture

```
Poker Engine → Agent Decision API → Simulation Runner → SQLite → Analytics
                                                      ↑
                                               Research Dashboard (observer)
```

| Layer | Role |
| --- | --- |
| Game engine | Deck, blinds, betting, min-raises, all-ins, side pots, showdown, histories |
| Hand evaluator | 5–7 card rankings, ties, wheels, straight flushes |
| Equity calculator | Weighted Monte Carlo; exact river vs range when practical |
| Strategy model | 1,326 combos, mixed frequencies, 13×13 visualisation |
| Opponent model | HUD stats + Bayesian shrinkage toward population priors |
| Decision engine | Ranges + equity + EV + fold equity + optional exploits |
| Simulation engine | Headless and live runners, seeded RNGs |
| Analytics engine | BB/100, EV, intervals, position/pot/archetype breakdowns |
| Dashboard | React observer UI |

## Default table

- NLHE 6-max
- SB $0.10 / BB $0.25
- 100 BB standard buy-in, stacks generally 40–200 BB
- Positions: UTG, HJ, CO, BTN, SB, BB
- Configurable rake (percent, cap, no-flop-no-drop)

## Commands

```bash
npm install
npm test                 # engine, pots, equity, EV, Bayesian HUD, sim
npm run dev              # API :8787 + dashboard :5173
npm run sim -- --hands 1000 --seed 42 --mode baseline
```

Headless experiments persist to `data/poker-lab.sqlite` (or `data/poker-lab.db`) with batched writes.

## Strategy modes

- **Baseline** — mixed, reasonably balanced frequencies from range/EV.
- **Exploitative** — same engine, with documented adjustments when HUD confidence is high enough (overfold, underfold, 3-bet frequency, river bluff scarcity). Every exploit stores evidence, sample size, confidence, baseline vs adjusted action, and estimated EV difference.

A +8 BB/100 heater over 2,000 hands is **not** treated as proof of superiority over +3 BB/100. The dashboard always shows sample size, standard error, and 95% intervals.

## Tests

Unit and scenario tests cover hand rankings, ties, side pots, all-ins, min-raises, legal actions, stack accounting, equity, range weighting, EV identities, and deterministic seeded simulations.
