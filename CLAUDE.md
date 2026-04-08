# CLAUDE.md

## Project Overview

Local-first Gantt chart planning tool. React 18 + Vite frontend, Express + JSON backend.
All data lives in flat JSON files. No database.

## Environment Setup

**Two separate installations exist:**

| Instance | Path | Port | Data | Purpose |
|----------|------|------|------|---------|
| **Production** | `~/Apps/actual-plan-prod/` | `localhost:3000` | `~/private/actual_plan_data/` (real) | Daily use |
| **Development** | `~/dev/actual_plan/` | `localhost:5173` (Vite) + `3001` (Express) | `data-dev/` (test data) | Agent work, feature dev |

**Never touch production data from the dev instance.** Agents work exclusively on the dev instance.

## Quick Commands

```bash
# Development (this repo)
npm run dev       # Vite on :5173 + Express on :3001, hot reload

# Production (~/Apps/actual-plan-prod/)
npm start         # Express on :3000, serves built frontend
```

To update production after stable changes land on master:
```bash
cd ~/Apps/actual-plan-prod && git pull && npm install && npm run build
```

## Architecture

- `server/` — Express backend, JSON file I/O, calendar integration
- `client/src/` — React frontend
  - `App.jsx` — State orchestration, API calls, toolbar
  - `components/GanttView.jsx` — Gantt chart rendering, drag handlers
  - `components/TaskEditor.jsx` — Modal editor for tasks/phases
  - `styles/main.css` — Dark theme styling
- `data-dev/` — Dev test data (gitignored): tasks.json, state.json, calendar-config.json
- `.claude/specs/` — Feature specifications for autonomous agent work (gitignored, not public)

## Data Model

Current: 2-level hierarchy (Phases > Tasks) in `tasks.json`.
Planned: Recursive tree structure (see `.claude/specs/WP-04-datenmodell-erweitern.md`).

## Key Conventions

- Atomic file writes (temp file + rename) to prevent data corruption
- Auto-save on every change — no manual save button
- All UI state in `state.json`, separate from task data
- Dark theme by default, CSS variables for theming
- wx-react-gantt library for base Gantt rendering
- Vite proxy reads PORT from `.env` dynamically via dotenv

## Testing

Playwright MCP is available for E2E testing. Agents should:
1. Ensure dev server is running (`npm run dev`)
2. Navigate to `http://localhost:5173` via Playwright
3. Test against the dev test data in `data-dev/`

## Gotchas

Read `.claude/gotchas.md` before debugging issues — it captures known pitfalls and their
solutions. **If you discover a new gotcha during your work, add it to that file.**

## Working with Specs

Feature specifications live in `.claude/specs/`. Each WP-XX file is self-contained.
`.claude/specs/AGENT-BRIEFING.md` is the entry point for agents picking up work.
When making direction decisions (data model, UX patterns, architecture), ask the user.
