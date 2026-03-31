# <img src="icons/favicon.svg" alt="Gantt App icon" width="28" /> Gantt App

A local-first Gantt planner for people who need a schedule that reflects real life, not just ideal dates.

It lets you plan tasks alongside your actual calendar, highlight events as blockers, and see how many real workdays remain inside a task window after weekends and selected calendar events are removed.

<p align="center">
  <img src="docs/screenshots/overview-full-compact.png" alt="Compact day view showing the Gantt app UI with task list, calendar lane, highlighted blockers, and task bars" width="100%" />
</p>

## What This App Is

This is a focused personal planning tool. It runs locally on your own machine, stores your data in local JSON files, and optionally uses Git to keep a lightweight snapshot history of planning changes.

Windows releases can be packaged as an installer. The app itself is still a cross-platform Node/React app that you run locally on Windows, macOS, or Linux.

## Why It Is Useful

Most Gantt charts only show the dates you typed in.

A common frustration is building a plan, then bouncing back and forth with your calendar to guess how the work will really fit around existing commitments.

This app is built around a more useful planning question: how much real time is actually available once weekends and your existing calendar commitments are taken into account?

It helps you plan in the context of real life, so your schedule reflects what actually matters instead of only ideal dates.

That makes it useful for students, researchers, freelancers, consultants, and solo builders who want a clear plan without moving to a large multi-user project system.

## Key Features

- Local-first planning on your own machine
- Phases, tasks, and milestones on one timeline
- Day, week, month, and quarter views
- Real available workday calculations on task and phase labels
- Calendar overlay from iCal feeds or Google Calendar OAuth
- Task notes stored with the task itself
- Drag-to-move, drag-to-resize, and drag-to-reorder editing
- PDF export
- Optional Git-backed snapshot history for planning data and GUI state
- Optional external data directory via `GANTT_DATA_DIR`

## Example Views

<p align="center">
  <img src="docs/screenshots/real-workdays-day-compact.png" alt="Compact day view showing task bars with real available workday counts after weekends and blocker events are removed" width="100%" />
</p>

Task and phase bars show real available workdays, not just raw calendar span.

<p align="center">
  <img src="docs/screenshots/history-panel-compact.png" alt="Compact history panel showing Git-backed snapshots, restore options, and read-only history browsing" width="100%" />
</p>

The optional History panel gives you lightweight Git-backed snapshots when your data directory is a Git repo.

## Quick Start

If this is your first install, use the detailed Windows, macOS, or Linux install section below first. This Quick Start is meant to show what to do once the launcher has started the local app.

1. Start the app from the launcher you created during install, then open your bookmarked local URL in the browser if it does not open automatically.
2. Click `Connect Calendar`.
3. For the quickest test, add an iCal URL, give it a label/color if you want, and save it. Each saved feed becomes its own collapsible calendar group, and you can add more later.
4. Create a phase and a task.
5. In Day view, double-click a calendar entry to toggle it as a blocker and watch the available workday count update.
6. Drag the end of the task until the available workdays match what you think the task really needs.
7. Optional: open `History` and save a snapshot once you have a first draft you want to keep.

## Install On Windows

Preferred installer flow:

1. Install Node.js 20+ from [nodejs.org](https://nodejs.org/).
2. Optional: install Git from [git-scm.com](https://git-scm.com/) if you want snapshot history or a private Git-backed data repo. You can do this later.
3. Download `GanttApp-Setup-<version>.exe` from the latest GitHub release and run it.
4. Keep the default install path `%LOCALAPPDATA%\Gantt App` unless you have a reason to change it.
5. Choose whether you want a Desktop shortcut and optional autostart on sign-in.
6. Let the installer finish `npm install`, generate `.env`, build the frontend, and create the shortcuts for you.
7. Launch `Gantt App` from the Start Menu or your Desktop shortcut.

The installer keeps the app in `%LOCALAPPDATA%\Gantt App` and, by default, stores your planning data in `%USERPROFILE%\Documents\Gantt App Data` so uninstalling the app does not delete your plans.

Manual ZIP fallback for contributors or manual installs:

1. Download this repo as a ZIP and extract it.
2. Move the extracted folder somewhere permanent before you continue.
Suggested examples: `%LOCALAPPDATA%\Gantt App` or `%USERPROFILE%\Apps\Gantt App`
3. If the extracted path looks like `Gantt App\gantt_app\...`, move the contents of the inner `gantt_app` folder up one level first.
4. Open that folder in File Explorer, click the address bar, type `powershell`, and press Enter.
5. Run setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

6. Create the launcher shortcut:

```powershell
powershell -ExecutionPolicy Bypass -File .\create-windows-shortcut.ps1
```

7. Double-click the new `Gantt App` desktop shortcut.

That shortcut uses the app icon and starts the single-port app without leaving a PowerShell window open. When the app is ready, Windows shows a notification with the local URL, usually `http://localhost:3000`. Bookmark that URL in your browser if you plan to use the app regularly. You can also pin the shortcut to Start or the taskbar from Windows Explorer.

Git users can skip the ZIP path and clone directly:

```powershell
git clone https://github.com/MoritzBur/gantt_app.git
cd gantt_app
powershell -ExecutionPolicy Bypass -File .\setup.ps1
powershell -ExecutionPolicy Bypass -File .\create-windows-shortcut.ps1
```

## Install On macOS

1. Install Node.js 20+ from [nodejs.org](https://nodejs.org/).
2. Optional: install Git if you want snapshot history or a private Git-backed data repo. You can do this later.
3. Download this repo as a ZIP and extract it.
4. Move the extracted folder somewhere permanent before you continue.
Suggested examples: `~/Applications/Gantt App` or `~/Documents/Gantt App`
5. Open Terminal and change into that folder.
Tip: type `cd `, drag the folder into Terminal, then press Return.
6. Run setup:

```bash
./setup.sh
```

7. Create the normal launcher:

```bash
./create-launcher.sh
```

8. Open the created launcher.
By default this creates `~/Applications/Gantt App.app`, which you can open from Finder and drag to the Dock.

When the app is ready, the launcher shows a macOS notification with the local URL. By default the URL is `http://localhost:3000`. Bookmark that URL in your browser if you plan to use the app regularly.

Git users can skip the ZIP path and clone directly:

```bash
git clone https://github.com/MoritzBur/gantt_app.git
cd gantt_app
./setup.sh
./create-launcher.sh
```

## Install On Linux

1. Install Node.js 20+ using your distro package, NodeSource, nvm, Volta, or another normal Linux install path.
2. Optional: install Git if you want snapshot history or a private Git-backed data repo. You can do this later.
3. Download this repo as a ZIP and extract it.
4. Move the extracted folder somewhere permanent before you continue.
Suggested examples: `~/Applications/gantt_app` or `~/opt/gantt_app`
5. Open a terminal in that folder.
On many desktops you can right-click the folder and choose `Open in Terminal`.
6. Run setup:

```bash
./setup.sh
```

7. Create the normal launcher:

```bash
./create-launcher.sh
```

8. Open the created launcher from your desktop or app menu.

The helper creates a launcher in `~/.local/share/applications` and, if a Desktop folder exists, also creates a desktop shortcut. On some desktops you may need to right-click the desktop shortcut once and choose `Allow Launching`.

When the app is ready, the launcher shows a Linux notification if `notify-send` is available. By default the URL is `http://localhost:3000`. Bookmark that URL in your browser if you plan to use the app regularly.

Git users can skip the ZIP path and clone directly:

```bash
git clone https://github.com/MoritzBur/gantt_app.git
cd gantt_app
./setup.sh
./create-launcher.sh
```

## Running The App

Simple everyday use:

- Windows: launch `Gantt App` from the installer-created Start Menu/Desktop shortcut, or double-click the shortcut created by `create-windows-shortcut.ps1`
- macOS: open the app created by `./create-launcher.sh`
- Linux: open the launcher created by `./create-launcher.sh`

Launcher behavior:

- it starts the single-port app on `http://localhost:3000` by default, or your configured `PORT`
- it waits for the app to be ready
- it shows the local URL in a platform-native notification where supported
- it does not force the browser to open by default
- if the app is already running, it tells you that instead of starting a second copy

If no data files exist yet, the app starts with an empty plan. By default it stores local data in `data/` inside the repo and creates missing files on first save. If you set `GANTT_DATA_DIR`, the app uses that directory instead.

Single-port runs serve the frontend and API from the same local port, so you open `http://localhost:3000` unless you changed `PORT` in `.env`.

## For Contributors

If you are working on the app itself, you can use the development servers:

- Windows: `powershell -ExecutionPolicy Bypass -File .\start.ps1`
- macOS/Linux: `./start.sh`

That runs Express on `http://localhost:3000` and Vite on `http://localhost:5173`.

If you want a direct single-port console run instead of the normal launcher flow:

- Windows: `powershell -ExecutionPolicy Bypass -File .\start.ps1 -Production`
- macOS/Linux: `./launch.sh`
- Manual equivalent: `npm run build` then `npm start`

To build the Windows installer from a Windows machine with Inno Setup 6 installed:

```powershell
powershell -ExecutionPolicy Bypass -File .\installer\build-installer.ps1
```

Windows release checklist:

1. Make sure the repo is on the commit you want to release and that `package.json` has the intended version.
2. On Windows, install Node.js 20+ and Inno Setup 6 if they are not installed yet.
3. From the repo root, run `powershell -ExecutionPolicy Bypass -File .\installer\build-installer.ps1`.
4. Confirm the installer exists at `installer\dist\GanttApp-Setup-<version>.exe`.
5. Run that installer on Windows and verify install, shortcut creation, launcher startup, and uninstall.
6. Upload only the generated `.exe` as the Windows release artifact. Do not commit `installer/dist/` or `installer/staging/`.

Optional calendar setup:

- The app works without any calendar integration.
- iCal is the simplest option. You can still seed it with `ICAL_URLS` in `.env`, but the app now manages individual iCal calendars as separate labeled/colorized groups.
- Google Calendar OAuth needs `CALENDAR_BACKEND=google`, Google client credentials, and a redirect URI that matches `http://localhost:<PORT>/api/calendar/callback`.
- In the Google backend, calendar membership still comes from `GOOGLE_CALENDAR_IDS`; the app lets you label/color those calendars, reorder them, and collapse them.

## Optional: Git-Backed Snapshots And Private Data Repo

The app works without Git. Git is only required for the snapshot/history workflow.

If the app's data directory is a Git repository:

- the History panel can create named snapshots
- the app can browse recent snapshots
- you can open older states read-only
- you can restore an older snapshot as the current plan

The app-created snapshot flow stages and commits:

- `tasks.json`
- `state.json`

Other files in the same data directory, such as `calendar-config.json` or `tokens.json`, are not included in app-created snapshots.

If you want to keep planning data separate from the software repo, set `GANTT_DATA_DIR` in `.env` to your own private directory. That directory can also be its own private Git repo.

Example `.env` values:

```env
# Windows example
GANTT_DATA_DIR=C:/Users/you/Documents/gantt_app_data

# macOS example
# GANTT_DATA_DIR=/Users/you/Documents/gantt_app_data

# Linux example
# GANTT_DATA_DIR=/home/you/gantt_app_data
```

Typical setup:

```bash
mkdir -p /path/to/your/gantt_app_data
cd /path/to/your/gantt_app_data
git init
```

Then set `GANTT_DATA_DIR` in `.env` and restart the app.

This is a strong setup for technical users because it gives you private local data, versioned planning history, and optional syncing to your own remote if you want it, while keeping the app source repo separate.

## Optional: Autostart On Login

Autostart is intentionally separate from normal launch. Nothing in the helper scripts enables it automatically, and the Windows installer only enables it if you opt in during setup.

The default workflow is still:

- run the launcher or start script manually
- open the browser yourself
- stop the app when you are done

If you want autostart later, keep it per-user and easy to undo:

- Windows: either enable the installer's `Start Gantt App when I sign in` option, or create a quiet shortcut with `powershell -ExecutionPolicy Bypass -File .\create-windows-shortcut.ps1 -Quiet` and place that shortcut in your Startup folder
- macOS: rebuild the launcher with `./create-launcher.sh --quiet`, then add `~/Applications/Gantt App.app` to Login Items
- Linux: rebuild the launcher with `./create-launcher.sh --quiet`, then copy `~/.local/share/applications/gantt-app.desktop` to `~/.config/autostart/`

Some users want the backend to start quietly without opening a browser on login. Keep those concerns separate. This repo does not force browser-opening as part of autostart.

## Troubleshooting

**`node` or `npm` is not found**

Install Node.js 20+ first, then rerun the setup helper or the Windows installer.

**PowerShell blocks `setup.ps1` or `start.ps1`**

Run them with:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

**A launcher says the app is already running**

Open the URL shown in the notification. If you expected a fresh start, stop the existing Gantt App process and then launch again.

**A launcher says the port is already in use**

Another app is already using that port. Change `PORT` in `.env` or stop the other app.

**`setup.sh`, `create-launcher.sh`, or `launch.sh` is not executable**

Run once:

```bash
chmod +x setup.sh create-launcher.sh launch.sh start.sh
```

**Missing `.env` or missing `SESSION_SECRET`**

Run the setup helper. It now creates `.env` automatically and replaces the example `SESSION_SECRET` with a random value if needed.

**Port already in use**

Set a different `PORT` in `.env`, then restart the app. If you use Google Calendar OAuth, update the redirect URI in Google Cloud to `http://localhost:<PORT>/api/calendar/callback`.

**History panel says snapshots are unavailable**

Basic planning still works. For snapshots, install Git and make sure the app's data directory is a Git repository.

**Google Calendar shows `redirect_uri_mismatch`**

The redirect URI in Google Cloud must exactly match `http://localhost:<PORT>/api/calendar/callback` for the port you are using.

## Scope / Limitations

- Windows now has an Inno Setup installer, but macOS and Linux still use the helper scripts from this repo.
- Launchers created by the helper scripts point at the current repo folder. If you move that folder later, rerun the launcher helper.
- It is designed for personal and self-managed work, not team collaboration.
- Calendar overlay is optional, but Google OAuth still requires a localhost callback setup.
- Git-backed snapshots are powerful for technical users, but they depend on Git being installed and available on `PATH`.

## Credits

This project is built on top of open-source software. In particular, thanks to:

- [Node.js](https://nodejs.org/) for the local runtime
- [Express](https://expressjs.com/) for the backend server
- [React](https://react.dev/) for the client UI
- [Vite](https://vitejs.dev/) for the frontend build and development tooling
- [wx-react-gantt](https://www.npmjs.com/package/wx-react-gantt) for the Gantt foundation used in the timeline UI
- [node-ical](https://www.npmjs.com/package/node-ical) for iCal calendar support
- [googleapis](https://www.npmjs.com/package/googleapis) for Google Calendar integration
- [html2canvas](https://html2canvas.hertzen.com/) and [jsPDF](https://github.com/parallax/jsPDF) with [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) for PDF export

There are also other direct dependencies used by the app and build pipeline. See [package.json](/home/moritz/dev/gantt_app/package.json) for the full list.
