# Personal Gantt App — Claude Code Spec

## What we're building

A personal project timeline tool that runs in your browser but is served from your local machine (no cloud, no accounts, your data stays on your computer). You open `http://localhost:3000` in any browser. It shows a Gantt chart of your thesis/life projects alongside a read-only overlay of your real Google Calendar events, so you can see how your project tasks fit around your actual life.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | Minimal, handles Google OAuth safely, serves the frontend |
| Frontend | React (Vite) | Modern, fast dev experience |
| Gantt library | SVAR React Gantt (MIT license) | Modern UI, real drag-and-drop, free |
| Data storage | `data/tasks.json` | Simple flat file, no database needed |
| Auth | Google OAuth 2.0 (local flow) | Required to read Google Calendar safely |
| Styling | CSS variables + custom CSS | No heavy UI framework needed |

---

## Project structure to generate

```
gantt-app/
├── .env.example          # Template for secrets — COMMITTED to git
├── .env                  # Actual secrets — NEVER committed to git
├── .gitignore            # Must block .env, tokens.json, node_modules
├── package.json          # Root — scripts to start both server and frontend
├── README.md             # Setup instructions (see below)
├── server/
│   ├── index.js          # Express server entry point
│   ├── routes/
│   │   ├── tasks.js      # GET/POST/PUT/DELETE for tasks
│   │   └── calendar.js   # Google Calendar fetch + OAuth flow
│   └── tokens.json       # OAuth refresh token cache — NEVER committed
└── client/
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── components/
        │   ├── GanttView.jsx      # Main Gantt chart component
        │   ├── TaskEditor.jsx     # Click-to-edit task name/dates modal
        │   └── CalendarOverlay.jsx # Google Calendar events as read-only rows
        └── styles/
            └── main.css
```

---

## Security — make this idiot-safe

This is the most important section. The app must be impossible to accidentally leak credentials from.

### `.gitignore` — generate this first, before anything else

```
# Secrets — never commit these
.env
server/tokens.json

# Dependencies
node_modules/

# Build output
client/dist/

# OS junk
.DS_Store
Thumbs.db
```

### `.env.example` — commit this, it's just a template

```
# Copy this file to .env and fill in your values
# Get these from Google Cloud Console (see README)
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here

# Which Google Calendar(s) to show (comma-separated calendar IDs)
# Your primary calendar ID is usually your Gmail address
GOOGLE_CALENDAR_IDS=your.email@gmail.com

# Port the app runs on
PORT=3000

# A random string used to sign sessions — generate one at random, doesn't matter what it is
SESSION_SECRET=change-this-to-any-long-random-string
```

### `.env` — never committed, created by user from `.env.example`

### Startup validation

In `server/index.js`, before starting the server, check that all required env vars are present. If any are missing, print a clear human-readable error and exit immediately:

```js
const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`\n❌ Missing required environment variable: ${key}`);
    console.error(`   Copy .env.example to .env and fill in your values.\n`);
    process.exit(1);
  }
}
```

### `server/tokens.json`

The Google OAuth refresh token is cached here after first login. This file:
- Is created automatically by the server after the user authenticates
- Must be listed in `.gitignore`
- Should be chmod 600 on creation if possible (owner read/write only)

---

## Data model — `data/tasks.json`

```json
{
  "phases": [
    {
      "id": "phase-1",
      "name": "Literature Review",
      "color": "#4A90D9",
      "start": "2026-03-01",
      "end": "2026-04-15",
      "tasks": [
        {
          "id": "task-1",
          "name": "Read core wake interaction papers",
          "start": "2026-03-01",
          "end": "2026-03-20",
          "done": false,
          "notes": ""
        }
      ]
    }
  ]
}
```

Rules:
- Phases are the top-level grouping (collapsible in the Gantt view)
- Tasks belong to exactly one phase
- Dates are ISO 8601 strings (`YYYY-MM-DD`)
- IDs are generated as `crypto.randomUUID()` on creation
- The file is rewritten atomically on every change (write to temp file, then rename) to prevent corruption

---

## Backend API

All routes are under `/api/`. The frontend talks to these.

### Tasks

| Method | Route | What it does |
|---|---|---|
| `GET` | `/api/tasks` | Returns full `tasks.json` content |
| `POST` | `/api/tasks/phase` | Creates a new phase |
| `PUT` | `/api/tasks/phase/:id` | Updates phase name/color/dates |
| `DELETE` | `/api/tasks/phase/:id` | Deletes phase and all its tasks |
| `POST` | `/api/tasks/phase/:phaseId/task` | Creates a new task in a phase |
| `PUT` | `/api/tasks/task/:id` | Updates task (name, dates, done, notes) |
| `DELETE` | `/api/tasks/task/:id` | Deletes a task |

All write endpoints immediately persist to `tasks.json` after the update.

### Calendar integration

| Method | Route | What it does |
|---|---|---|
| `GET` | `/api/calendar/status` | Returns connection status for the active backend |
| `GET` | `/api/calendar/config` | Returns grouped calendar config for the active backend |
| `POST` | `/api/calendar/config` | Saves grouped calendar config for the active backend |
| `GET` | `/api/calendar/auth` | Redirects user to Google OAuth consent screen |
| `GET` | `/api/calendar/callback` | OAuth callback, saves token, redirects to `/` |
| `GET` | `/api/calendar/events?start=...&end=...` | Returns events from all configured calendars in the given date range |
| `POST` | `/api/calendar/disconnect` | Deletes `tokens.json`, clears session |

Calendar config response shape:

```json
{
  "version": 2,
  "backend": "ical",
  "calendars": [
    {
      "id": "ical-abc123",
      "source": "ical",
      "label": "Work",
      "color": "#4A90D9",
      "icalUrl": "https://example.com/work.ics",
      "enabled": true
    }
  ]
}
```

For the Google backend, calendar membership still comes from `GOOGLE_CALENDAR_IDS`; those entries use `calendarId` instead of `icalUrl` and can be relabeled/recolored in the UI.

Calendar events response shape:

```json
[
  {
    "id": "ical-abc123::google-event-id",
    "sourceEventId": "google-event-id",
    "calendarKey": "ical-abc123",
    "title": "Meeting with supervisor",
    "start": "2026-03-25",
    "end": "2026-03-25",
    "allDay": true,
    "calendarId": "your.email@gmail.com",
    "source": "google"
  }
]
```

---

## Google OAuth flow (local)

Use the `googleapis` npm package. The flow:

1. User visits `/api/calendar/auth` → server generates auth URL with scopes `calendar.readonly` → redirects user to Google
2. Google redirects back to `http://localhost:3000/api/calendar/callback?code=...`
3. Server exchanges code for tokens, saves refresh token to `server/tokens.json`
4. Server redirects user back to `/` (the app)
5. On subsequent startups, the server loads the refresh token from `server/tokens.json` and uses it silently — no re-auth needed

In Google Cloud Console, the OAuth redirect URI must be set to: `http://localhost:3000/api/calendar/callback`

---

## Frontend — Gantt view

### Layout

```
┌─────────────────────────────────────────────────────┐
│  [+ Add Phase]  [Connect Google Cal / ✓ Connected]  │  ← top bar
├──────────────┬──────────────────────────────────────┤
│ Task list    │  Timeline (scrollable horizontally)  │
│              │                                      │
│ 📅 Google Cal│  ░░░░ event block ░░░░               │  ← read-only rows
│  ├ Event 1  │                                      │
│  └ Event 2  │                                      │
│              │                                      │
│ 📋 Phase 1   │  ████████████████                   │  ← phase bar
│  ├ Task A   │    ███████                            │
│  └ Task B   │          ████████                    │
│              │                                      │
│ 📋 Phase 2   │                  ██████████████      │
│  └ Task C   │                      ████            │
└──────────────┴──────────────────────────────────────┘
```

### Interactions

- **Drag task bar** left/right → updates start/end dates, auto-saves
- **Drag task bar edge** → resize duration, auto-saves
- **Click task bar or task name** → opens `TaskEditor` modal (edit name, dates, notes, done checkbox)
- **Click phase row** → collapse/expand tasks under it
- **Click phase name** → edit phase name inline
- **Hover task** → show tooltip with full name + date range
- **Zoom controls** → buttons to switch between Day / Week / Month / Quarter view
- **Today line** → vertical red line marking today's date

### Calendar overlay

- Shown as a visually distinct section at the top of the task list, labeled "Calendars"
- Each configured calendar has its own header row, color, reorder handle, and collapse toggle
- Events are rendered as non-draggable, slightly transparent bars in that calendar's configured color
- Multi-day events span their full duration on the timeline
- Single-day events show as a narrow block
- If a calendar is collapsed, its event rows are hidden but any previously activated blocker overlays remain active
- If not connected, show a placeholder row: "Connect Calendar →"
- Fetch events for the currently visible date range + 2 weeks on each side as buffer

### Auto-save

Every change (drag, edit, add, delete) saves immediately via a `PUT` or `POST` to the API. No save button. Show a brief "Saved ✓" indicator in the top bar that fades after 1.5 seconds. On network error, show "Save failed ✗" in red.

---

## Design

Clean, functional, dark-mode by default. Think: engineering tool, not a corporate SaaS product.

- Dark background (`#0f1117`), slightly lighter sidebar (`#161b22`)
- Phase bars: user-assigned colors (provide 8 sensible defaults to pick from)
- Google Calendar events: muted steel blue, clearly non-editable
- Today line: red, 2px
- Font: monospace for dates/IDs, sans-serif for everything else
- No unnecessary shadows, gradients, or decoration
- Must be usable on iPad screen width (min ~768px) — touch targets at least 44px

---

## Running the app — two processes, one command

Use `concurrently` to run both the Express server and the Vite dev server together:

```json
"scripts": {
  "dev": "concurrently \"npm run server\" \"npm run client\"",
  "server": "node server/index.js",
  "client": "vite client/",
  "build": "vite build client/",
  "start": "node server/index.js"
}
```

In production mode (`npm start`), Express serves the built Vite output from `client/dist/` as static files, so only one process runs.

---

## README.md — generate this

The README must include complete setup instructions for a non-web-developer. Include:

1. **Prerequisites**: Node.js v20+ (link to nodejs.org), how to check (`node --version`)
2. **Install**: `git clone` / download, then `npm install`
3. **Google Cloud Console setup** — step by step:
   - Go to console.cloud.google.com
   - Create a new project (name it anything)
   - Enable the Google Calendar API
   - Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: "Web application"
   - Add authorized redirect URI: `http://localhost:3000/api/calendar/callback`
   - Copy the Client ID and Client Secret
4. **Configure secrets**: `cp .env.example .env`, then fill in the values
5. **Run**: `npm run dev`, open `http://localhost:3000`
6. **First run**: Click "Connect Google Calendar" and complete the OAuth flow once
7. **Stopping**: `Ctrl+C` in the terminal

---

## Out of scope for v1 (do not implement)

- Pushing tasks to Google Calendar
- User accounts or authentication to the app itself
- Multiple users
- Third level of hierarchy (phases → sub-phases → tasks)
- Mobile layout below 768px
- NAS/remote hosting
- Recurring tasks
- Task dependencies / critical path

These should be architecturally possible to add later without a rewrite.

---

## Sample data

Seed `data/tasks.json` with 2–3 example phases and 3–5 tasks each, using plausible thesis-style task names (literature review, simulations, writing chapters, etc.) spanning March–August 2026. This lets the user see a working chart immediately on first launch.
