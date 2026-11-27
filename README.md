# Team day planner

Plan which teams sit where on their team days, across the floors of an office, and see
conflicts the moment they arise.

It runs in the browser. With Supabase set up (below) the plan is kept in one shared
database, so everyone who opens the app works on the same plan. Without it, the plan stays
in your own browser until you export it as a file.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5183.

### Shared plan in Supabase

1. In the Supabase SQL editor, run `supabase/migrations/20261127000000_plans.sql`. It
   creates the `plans` table, one row per plan, with the whole plan as JSON.
2. Give the app the project URL and the publishable (anon) key, from Project Settings > API:
   - locally: copy `.env.example` to `.env.local` and fill it in;
   - on Vercel: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as environment
     variables, or connect the Supabase integration, whose `NEXT_PUBLIC_SUPABASE_URL` and
     `NEXT_PUBLIC_SUPABASE_ANON_KEY` are read as well. Redeploy afterwards: the values are
     built into the page.
3. The first time the app opens on an empty database it stores the plan it has: the one
   kept in that browser, if any, otherwise the starting plan.

There is no sign-in: anyone who can open the app can change the plan (not delete it).
Never use the secret or service_role key; the key ends up in the page.

```bash
npm run build
```

writes **one self-contained file**, `dist/index.html` (code, styles, fonts and the bundled
floor plan inlined). Open it with a double click, mail it to a colleague, or put it on any
intranet page or static host.

```bash
npm test          # the planning engine and the views
npm run typecheck
```

## How it works

Three views, in the order you would use them the first time:

1. **Floors**: add a floor plan image and draw a box around each group of desks. Enter the
   seats of each box and say what it is for:
   - *Desks*: regular workplaces. Teams are seated here, and only these count as capacity.
   - *Overflow seats*: touchdown benches and open tables, for busy days only.
   - *No seating*: meeting rooms, lounges, pods. Teams can never be placed here.
2. **Teams and days**: enter each team with its size and click the days it wants to come in.
   The header shows how full every weekday gets, before a single seat is placed, and
   suggests which team could move when a day is too full.
3. **Plan**: pick a weekday and a floor, pick a team, and click the areas where it should
   sit. The team gets the same seats on all its team days; switch to "Only Tuesday" to make
   an exception for one day. "Seat automatically" proposes seats for one team or for
   everyone.

Floor 4 is included, traced from the supplied drawing: 66 desks in 18 clusters, 32 overflow
seats, and the meeting rooms and pods marked as no seating. The area names (NW 1, N 2, ...)
are placeholders: rename them in **Floors**.

### What the planner checks

| Level | Meaning | Examples |
| --- | --- | --- |
| Conflict | Cannot work as planned | An area holds more people than it has seats on a day; a team is placed in a meeting room; a day needs more seats than the building has |
| Still to seat | Not finished | A team day without seats, or with too few |
| Warning | Works, but not as asked or intended | A day only fits with overflow seats; a team is split over two floors; a wanted day is not planned |
| Note | Worth a glance | A team sits in two separate places; a team holds more seats than it needs |

Nothing is ever blocked: planning passes through states that do not fit yet. Conflicts are
shown on the plan, on the weekday, on the floor and in one list, most with a one-click fix.
Warnings and notes can be accepted with a reason; an acceptance lapses when the numbers
behind it change.

### Words used

- **Team day**: a weekday on which the whole team comes to the office.
- **Wanted / could also come / cannot come / not asked**: what a team said about a weekday.
  The planned days start out as the wanted days and only differ when you decide so; a team
  is never moved to a day it was not asked about without the suggestion saying "ask first".
- **Seats needed**: team size times the expected attendance, rounded up.
- **Keep free**: a share of the desks held back every day for visitors and for people who
  come in outside their team day.

### Keys

| Where | Key | What it does |
| --- | --- | --- |
| Everywhere | Ctrl/Cmd + Z, Ctrl/Cmd + Shift + Z | Undo, redo |
| Plan | 1 to 5 | Monday to Friday |
| Plan | [ and ] | One floor down, one floor up |
| Plan | N | The next team that still needs seats |
| Plan | Esc | Stop seating a team, deselect an area |
| Teams and days, on a day | Space or Enter | Switch the day on or off |
| Teams and days, on a day | W, C, N, X | Wants, could also come, not asked, cannot come |
| Teams and days, on a day | Arrow keys, Shift + F10 | Move between days, open the day's menu |
| Floors | Arrow keys (Shift for bigger steps) | Nudge the selected area |
| Floors | Ctrl/Cmd + D, Delete | Duplicate, remove the selected area |

## Your data

- The plan is saved automatically, a moment after every change: to the shared database when
  Supabase is set up ("Saved online"), otherwise in this browser (IndexedDB, "Saved in this
  browser"; clearing the browser's site data removes it).
- Two people editing at once never overwrite each other unnoticed. Every save names the
  version it builds on; when someone else saved in between, the bar says "Changed
  elsewhere" and nothing is saved until you choose **Load theirs** (your latest changes are
  dropped) or **Keep mine** (theirs are overwritten). Coming back to the window loads what
  others saved meanwhile, as long as you have nothing unsaved.
- When the database cannot be reached, your changes stay in the window and are saved once
  it is back; the browser asks before you close the window with unsaved changes.
- **File > Export plan file** writes everything, floor plan images included, to one JSON
  file. That file is the copy to keep and to share; **File > Open plan file** reads it back.
- **File > Export seating as CSV** gives one line per team, day and area for a spreadsheet.
  Columns are separated the way the spreadsheet on your computer expects: by semicolons
  where the regional settings use a decimal comma (and in Switzerland), otherwise by commas.
- **File > Print** makes one landscape page per weekday and floor, plus a week overview.
- The planner knows teams and head counts, never individual people.

## For developers

```
src/
  domain/     the planning engine: pure TypeScript, no React, fully tested
    types.ts      data model and its invariants
    model.ts      derived numbers: seats needed, who sits where, how full a day is
    reducer.ts    every edit as an action; pure, undoable
    conflicts.ts  conflict recognition
    autoseat.ts   automatic seating proposals
    dayMoves.ts   "which team could move to another day"
    fixes.ts      one-click fixes for issues
    files.ts      plan files, CSV export, pasted team lists (untrusted input)
    placing.ts    what a click on an area does for a team
    geometry.ts   which areas are next to each other
  state/      the store (undo, redo, autosave) and what the planner is looking at
    storage.ts    where the plan is kept: Supabase or this browser
    saving.ts     autosave, versions and conflicts between windows
  ui/         the views; ui/sheet is the floor plan drawing itself
  styles/     design tokens and shared styles
```

Vite, React and TypeScript; Supabase as the only backend, and no state library. Fonts are bundled, so nothing
is fetched at run time.
