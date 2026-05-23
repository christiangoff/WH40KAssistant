# WH40K Assistant

A personal army builder and match tracker for Warhammer 40,000 10th Edition. Manages your model collection, builds army lists with per-model weapon loadouts, and tracks matches in real time — including wounds, command points, victory points, stratagems, and turn state.

---

## Features

### Collection
- Add unit types from your physical collection with a model count representing what you own
- Fetch stats and stratagems automatically from [Wahapedia](https://wahapedia.ru) by pasting a unit URL
- View full stat blocks (Movement, Toughness, Save, Wounds, Leadership, OC, invulnerable save) and weapon profiles

### Army Builder
- Build multiple named armies with a configurable point limit
- Add models from your collection — the app enforces that you can't assign more models than you own across all armies
- Organize models into **units** (e.g., "Terminators", "Command Squad") with a colored left-border grouping
- Each army entry can have:
  - A **model count** (how many physical models this entry represents)
  - A **weapon loadout** — per-entry checkbox selection of which weapons this model or group carries
  - A **label** — auto-generated from the selected weapons (e.g., "Assault cannon, Power fist") or typed manually; used as the wound card title in matches
- Point totals tracked live against the army's point limit with a progress bar

### Match Tracker
- Start a match from any army — every model becomes its own wound card (one card per physical model, regardless of how they're grouped in the army builder)
- Units with the same type are numbered sequentially (Terminator Squad 1, Terminator Squad 2, …)
- **Wound cards** show:
  - Model name as the primary header
  - Weapon loadout as the sub-header
  - A color-coded wound bar (green → yellow → red)
  - ± wound buttons and a Destroy / Restore toggle
  - Expandable full stat block
- Models grouped by unit in the match view; destroyed models shown in a separate section
- **Top bar** tracks:
  - CP (Command Points) with ± buttons
  - My VP and Opponent VP with ± buttons
  - Round (1–5)
  - Phase (Command / Movement / Shooting / Charge / Fight)
  - Turn (Mine / Opponent)
- **Weapon summary panel** per unit — aggregates all weapons carried by active models, showing total count and full profile (Range, Attacks, BS/WS, Strength, AP, Damage, abilities)
- **Stratagem sidebar** per unit — lists all relevant stratagems with a search/filter; stratagems usable in the **current phase and turn** are highlighted in green and sorted to the top with a "Now" badge
- Delete matches from the matches list

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS (dark theme) |
| Database | SQLite via `better-sqlite3` |
| Scraping | Cheerio (Wahapedia HTML parser) |
| Runtime | Node.js |

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Install & Run

```bash
git clone https://github.com/christiangoff/WH40KAssistant.git
cd WH40KAssistant
npm install
PORT=3002 npm run dev
```

Open [http://localhost:3002](http://localhost:3002).

The SQLite database is created automatically at `data/warhammer.db` on first run. The `data/` directory is gitignored — your collection and match history stay local.

---

## Project Structure

```
app/
  page.tsx                        # Home / dashboard
  layout.tsx                      # Root layout with NavBar
  collection/
    page.tsx                      # Unit collection manager
  armies/
    page.tsx                      # Army list
    [id]/page.tsx                 # Army builder (units, loadouts, squads)
  matches/
    page.tsx                      # Match list + create
  match/
    [id]/page.tsx                 # Live match tracker

  api/
    units/
      route.ts                    # GET all, POST new unit
      [id]/route.ts               # GET, PUT, DELETE unit
      [id]/fetch-stats/route.ts   # POST — scrape Wahapedia for stats
    armies/
      route.ts                    # GET all, POST new army
      [id]/route.ts               # GET, PUT, DELETE army
      [id]/units/route.ts         # POST add unit to army
      [id]/units/[unitId]/route.ts# PUT update, DELETE remove army unit
      [id]/squads/route.ts        # GET, POST squads
      [id]/squads/[squadId]/route.ts # PUT rename, DELETE squad
    matches/
      route.ts                    # GET all, POST create match
      [id]/route.ts               # GET, PUT, DELETE match
      [id]/units/[unitId]/route.ts# PUT update wound/destroy state

components/
  NavBar.tsx                      # Top navigation
  StatBlock.tsx                   # Reusable stat block renderer

lib/
  db.ts                           # SQLite connection, schema init & migrations
  wahapedia.ts                    # Wahapedia scraper and stat parser
```

---

## Database Schema

```sql
units           -- model types in your collection (stats fetched from Wahapedia)
armies          -- named army lists with a point limit
army_units      -- models assigned to an army (weapon selection, label, squad, count)
army_squads     -- named unit groupings within an army
matches         -- match sessions (CP, VP, round, phase, active player)
match_units     -- per-model wound cards snapshotted from army at match creation
```

Migrations run automatically on startup via `PRAGMA table_info` checks — no manual migration steps needed.

---

## Wahapedia Scraping

Paste a Wahapedia unit URL (e.g. `https://wahapedia.ru/wh40k10ed/factions/space-marines/Terminator-Squad`) into the collection page. The scraper fetches:

- Core stats (M, T, Sv, W, Ld, OC, invulnerable save)
- All weapon profiles (ranged and melee) with full stats and special abilities
- Stratagems available to the unit, including their timing (`WHEN`), target, effect, and CP cost
- Points per model and points table

Scraped data is cached in the database (`stats_json`) and can be re-fetched at any time.

---

## Stratagem Phase Matching

The match tracker highlights stratagems available in the current game state. A stratagem is considered usable when:

1. Its `WHEN` field references the current **phase** (or says "Any phase")
2. Its timing clause matches the current **turn**:
   - `"Your [Phase]"` → highlighted on **your** turn
   - `"Your opponent's [Phase]"` → highlighted on **opponent's** turn
   - Phase only, no player qualifier → highlighted on **either** turn

The player qualifier check is scoped to the timing clause only (text before the first comma), so body text like "…a unit from your army…" doesn't incorrectly restrict the stratagem to one player's turn.
