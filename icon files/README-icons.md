# Actual Plan — Icon Assets

## Palette

| Role      | Hex       | Usage                        |
|-----------|-----------|------------------------------|
| Background| `#16181d` | Launcher icon bg only        |
| Emerald   | `#27a85f` | Top bar (primary/plan)       |
| Crimson   | `#c0282a` | Bottom bar (blocker/conflict)|

---

## Files

### `icon-launcher.svg`
- **Size:** 512×512px with viewBox
- **Use for:** Desktop shortcut, Windows `.lnk` icon, PWA manifest `icons[]`, macOS dock
- **Has dark background:** Yes (`#16181d`, rounded square rx=104)
- **Implementation:**
  - Windows shortcut: reference this file in `create-windows-shortcut.ps1`
  - PWA manifest (`manifest.json`): add as `{ "src": "/icon-launcher.svg", "sizes": "512x512", "type": "image/svg+xml" }`
  - If a `.ico` is needed for Windows, rasterize this at 256×256 and 48×48 into a multi-size `.ico`

### `favicon.svg`
- **Size:** viewBox 196×152 (no fixed width/height — scales freely)
- **Use for:** Browser tab favicon, bookmarks bar, browser bookmark icon
- **Has dark background:** No — intentionally transparent so browser chrome provides the background. Works on both light and dark browser themes.
- **Implementation:**
  - Place at `client/public/favicon.svg`
  - Add to `index.html` inside `<head>`:
    ```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    ```
  - Remove any existing `favicon.ico` reference or add it as fallback:
    ```html
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    ```

---

## Design rationale

Two bars, staggered in time — the canonical Gantt visual reduced to its simplest form.
- Top bar (emerald): the planned work
- Bottom bar (crimson): the blocker / calendar conflict
- The horizontal shift between them communicates scheduling offset at a glance

No grid lines, no today-line, no labels. The favicon version drops the background entirely so the two colored shapes dominate even at 16px.

---

## What NOT to change

- Do not add padding inside the favicon — the bars should fill the viewBox edge to edge
- Do not add a dark background to the favicon — it will look like a black square on dark browser chrome
- Do not change the corner radius below rx=14 on the favicon bars — at small sizes this is what makes them readable as bars rather than rectangles
