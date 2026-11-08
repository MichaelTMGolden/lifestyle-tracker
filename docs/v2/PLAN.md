# Personal Dashboard — Version 2 Plan

*Revised 6 Nov 2026 with your answers. Updated 8 Nov 2026: all phases done (see Status).*

## Status (8 Nov 2026): revamp complete

Every phase below has shipped. Each pull request linked here is merged into `main` and deployed to Render.

| Phase | What shipped | PRs |
|---|---|---|
| 0 · Safety net | Data export, nightly backups and a restore drill. `render.yaml` plans now match the live services. | [#1](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/1), [#4](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/4) |
| 1 · Speed | One Today request, instant taps through the query cache, bounded streaks, and the API split by feature. | [#2](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/2), [#3](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/3) |
| 2 · Look and shell | The Rite look, the bottom-tab shell and the component kit in `web/src/ui/`. | [#5](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/5) |
| 3 · Core pages | Habits, Today and Plan rebuilt. | [#6](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/6), [#7](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/7), [#8](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/8) |
| 4 · Hide and tidy | Unused pages hidden (their data is kept), dead code deleted, and unknown `/api` paths now return 404. | [#9](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/9), [#10](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/10) |
| 5 · Extras | Installable app, offline habit logging, quick log, habit reminders, and Health with a weekly summary. | [#11](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/11) to [#15](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/15) |
| Remaining pages | Routine (was Schedule), Connect, Settings, Challenges and the goal form moved to the Rite kit, plus the v1 CSS cleanup. | [#16](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/16) to [#19](https://github.com/MichaelTMGolden/lifestyle-tracker/pull/19) |

**Decisions made along the way**
- **Challenges** stay a separate section under Habits, restyled on the kit. They were not folded into Goals: daily chains and counts don't fit the hours model that goals use.
- **Calendar** stays read-only, through each calendar's secret iCal address.

**Still needs you**
- **Weekly summary:** add `ANTHROPIC_API_KEY` to the Render web service's environment. Until you do, the Health page explains how to set it up. The first summary is written the Monday after at 8:00.
- **Reminders:** turn on a reminder for one habit on your phone, to confirm a real notification arrives. This hasn't been tested on a phone yet.

## 1. What v2 is for

v2 does three things well, on a phone:

1. **Daily practice:** habits, timers, goals, streaks and heatmaps. You use these every day, and they get the most investment.
2. **Running the day:** Today, tasks and your calendar. You use Tasks only sometimes now; v2 aims to make them worth opening daily.
3. **Keeping the history safe:** every habit log, timer session and goal you've recorded carries over unchanged.

Everything else is either **parked** (its data is kept, its sync keeps running, its page is hidden) or **hidden** (its data is kept and its page removed). Nothing is deleted from the database.

| v1 feature | Your usage | v2 treatment |
|---|---|---|
| Habits, habit timers, goals, streaks, heatmaps | Daily | **Core.** Redesign and improve. |
| Today page | Daily | **Core.** Rebuild mobile-first. |
| Tasks, daily to-dos | Sometimes, want daily | **Core.** Merge with calendar into one "Plan" view. |
| Google Calendar sync | Want daily | **Core.** Drives the Plan view. |
| Weekly Schedule (timetable) | Not used (travelling) | **Rethink.** Optional "routine template" that only appears when switched on. Calendar comes first. |
| Health, Garmin sync | Not yet | **Parked.** Sync keeps collecting data; page hidden until you're settled. |
| Nutrition, Artist, Weekly Review, Bingo | Never | **Hidden.** Data kept; routes and nav items removed. |
| Challenges | Not mentioned | **[YOU]** Assumption: fold into Goals as a "streak goal" type. |
| Settings | — | Minimal, under a "More" menu. |

## 2. Findings from v1 (why it's slow and uneven)

- **Every tap reloads everything:** the Today page makes 8 API calls when it opens, and makes all 8 again after every tap (`TodayPage.tsx:71`), plus a poll every 3 minutes.
- **Nothing is cached:** there's no shared client cache, so each page starts blank and fetches from scratch.
- **Habits get slower over time:** `/api/habits` loads every completed date ever recorded to compute streaks (`ApiEndpoints.cs:978`).
- **One giant backend file:** `ApiEndpoints.cs` is 2,062 lines, and 8 CSS files total about 1,700 lines with no shared component kit.
- **Hosting:** your database is about 5 months old and still Available, so it's almost certainly on a paid plan. **[YOU]** Check the `personal-dashboard` web service's instance type: if it's Free, it sleeps when idle and gives you 30–60 s cold starts. Also, `render.yaml` still says `plan: free` for both. I'll update it to match your real plans so a Blueprint sync can't downgrade them.

## 3. Approach

Rebuild in place. Keep the .NET API and the same Postgres database. Build a new mobile-first frontend shell, then move features over one at a time. Database migrations only add things.

## 4. Phases

### Phase 0 — Safety net *(1 session)*
- Fix `render.yaml` plans so they match what you actually pay for.
- **Nightly automated backup** (`pg_dump` to private storage), plus one restore drill into a local database.
- **"Download my data" export** (JSON/CSV) covering habits, logs, timers, goals, challenges, tasks, to-dos and calendar.
- A migration safety test: run new migrations against a copy of the production dump and confirm row counts are unchanged.

### Phase 1 — Speed *(2 sessions)*
- **TanStack Query** cache plus **optimistic updates**: habit ticks, timer start/stop and to-dos change on screen instantly.
- Mutations return the changed item, which ends the reload-everything pattern.
- A single `/api/today` bundle that replaces the 8 calls.
- Habit streaks computed from bounded data, or stored, instead of from full history.
- Split `ApiEndpoints.cs` by feature (a pure move, covered by the existing tests).
- Measure before and after: Today load time, tap-to-update time, and bundle size.

### Phase 2 — New look and shell *(2 sessions)*
- **Fresh dark aesthetic, gothic-adjacent.** I'll mock up 2–3 directions for you to pick from before building: near-black base, one deep accent, a refined display face for headings, a highly legible body font, tabular numbers, and data that carries the colour.
- A design-token file plus about 12 components: Card, Stat, Button, Pill, Check row, Heatmap, Ring/progress, Sheet, Toast-with-Undo, Tabs, List row, Skeleton.
- **Phone-first navigation:** a bottom tab bar with **Today · Habits · Plan · More**, with thumb-reachable actions and bottom sheets instead of modals.

### Phase 3 — Core pages *(1–2 sessions each, in this order)*
1. **Habits:** one screen for each habit's streak, its heatmap (with a full-year view), goal progress and timer. Starting a timer takes one tap; logging time takes two. Weekly and daily cadences show clearly, along with each habit's best streak and consistency %.
2. **Today:** the timers you have running, today's habits as large tap targets, your next calendar event, today's tasks, and quick capture. No scrolling needed for the essentials.
3. **Plan:** tasks and calendar together. A day/week agenda shows calendar events with your tasks around them. You can drag a task onto a day, an "inbox → today" triage takes one swipe, and the tomorrow planner lives here. The routine template is optional.

### Phase 4 — Hide and tidy *(1 session)*
- Remove routes and nav for Nutrition, Artist, Review and Bingo, and the Health page for now. **Tables and data stay.** The Garmin sync keeps running.
- Delete dead frontend code and the legacy `/api/summary`.

### Phase 5 — Extras *(pick later)*
- **Installable PWA with offline logging:** taps queue up and sync once you're back online. This is high value on a phone.
- **Habit reminders:** a push notification if a habit isn't logged by a chosen time.
- **Quick log:** type "guitar 30" to log 30 minutes.
- **Health returns, agent-driven:** when you're ready, bring Health back as a simple page plus a scheduled agent that reviews your Garmin, habit and calendar data and writes a weekly summary. The existing Weekly Review code (deterministic digest + LLM judgement) is the starting point.

## 5. Open questions
1. **[YOU]** What is the web service's instance type: Free or Starter?
2. **[YOU]** Challenges: should they fold into Goals, or stay as their own thing?
3. **[YOU]** Your calendar: is Google Calendar via the secret iCal link still your main calendar? Making Plan two-way (creating events from the app) would need OAuth. Read-only works today.

## 6. Data-safety rules (every PR)
- Migrations only add things. No drops or renames without a backup step first.
- Back up before any deploy that includes a migration.
- Hiding a feature never deletes rows.
