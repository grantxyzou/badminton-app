# Flag retirements — the two burns behind the rule

Moved out of `CLAUDE.md` on 2026-10-11. The rule itself stays there (Feature Flags → Retirement rule): every flag carries a `plannedRemoval` ISO date, and retiring one means deleting its `off` branch, not just the switch.

- **This used to be prose, and prose is how the field died.** Eleven flags said "after X is promoted to stable + lived-in for 2 weeks" — a condition that became impossible on 2026-08-25 when the second deployment was deleted and there stopped being a promotion event. They sat un-retireable for up to three months, because nobody notices a sentence quietly becoming false, whereas anybody notices a date in the past.
- **Retiring a flag means deleting the `off` branch, not just the switch.** That branch has shipped untested for months and the on-path has moved on around it; `NEXT_PUBLIC_FLAG_STATS_V2` is the cautionary case (below). The CSS half is the risky half: a selector list is a shared rule, so deleting "every rule mentioning the legacy class" can orphan the selectors it was grouped with. Removing `.nav-glass` nearly deleted `.rail-bar`'s own field-mode border and shadow that way.
- **`NEXT_PUBLIC_FLAG_STATS_V2` is RETIRED** (2026-08-25). It had been inert-on since Stage 8 — turning it off restored nothing, it only 404'd `/api/stats/club/bands`, `/club/gear` and `/drills/done` and left the tab showing load errors. Gone from `lib/flags.ts`, both workflows, `dev:next` and `.env.local.example`; the three route guards and the dead `!statsV2` UI branches went with it. Note the claim that "no UI read it" had gone stale: `CheckInSheet` still had **11** forks on it and `ProfileTab` two, all resolving to the on-branch. Don't set it in `.env.local` — it does nothing.

## Retirements with a story

The full set of retired flags is `git log -p -- lib/flags.ts`; this table lists the ones with a record worth keeping.

| Flag | Retired | Note |
|---|---|---|
| `NEXT_PUBLIC_FLAG_STATS_V2` | 2026-08-25 | above |
| `NEXT_PUBLIC_FLAG_LEDGER` | 2026-08-29 | cover modes unconditional |
| `NEXT_PUBLIC_FLAG_VISUAL_FIELDS` | 2026-09-10 | the `html:root` specificity rule in `CLAUDE.md` → Design System is what survived it; `docs/plans/visual-fields-direction.md` |
| `NEXT_PUBLIC_FLAG_KUDOS` | 2026-09-10 (#352) | |
| `NEXT_PUBLIC_FLAG_PUSH_NOTIFY` | 2026-09-10 (#353) | |
| `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE` | 2026-09-28 | twelve off-branches and six route guards went with it; `docs/plans/value-hub-slice-0.md` |
| `NEXT_PUBLIC_FLAG_GEAR_SETUP` | 2026-10-14 (#624) | the flag-off Gear register (`GearPickRail`, `YourKitCard`, `BagList`, `GearSheet`, six test files) went with it, and `GearPickCard` the next day once nothing rendered it (its pick types moved to `components/stats/gearPick.ts`). Two days late; the plan's kill criterion could not be read as written, so `docs/plans/equipment-setup-card.md` records a baseline instead. |

`lib/flags.ts` is the registry of what is still live; `scripts/check-flag-sync.mjs` reports the overdue ones.
