# Read Later

A Chrome extension (Manifest V3) for saving articles to a reading list without leaving the page you're on. Save from the toolbar popup, a keyboard shortcut, a right-click menu, or a floating button that appears on every page — then browse, search, mark items read, and delete them from a dedicated reading list manager. Your list is stored with `chrome.storage.sync`, so it follows you to any other computer signed into the same Google account with Chrome sync turned on.

## Features

- One-click save from the toolbar popup, which also shows your full list with search, mark-as-read, delete, and drag-to-reorder
- Keyboard shortcuts (same combo on every platform): `Ctrl+Shift+S` for instant saving with an on-page toast confirmation, `Ctrl+Shift+L` to open the reading list
- Right-click context menu — "Add link/page to Reading List" on any page or link (also opens a standalone Reading List Manager window from the toolbar icon's right-click menu)
- A floating save button injected on every `http`/`https` page, reflecting the article's real saved/read state: click to save (orange), double-click to toggle read/unread (spring green `#00FF7F`), or hold for 2.5s to remove it
- An options page to turn the floating button or the right-click menu off individually (applied live to already-open tabs), manage keyboard shortcuts, and export/import your reading list as JSON or a Pocket CSV export
- Toolbar badge feedback for every save action (SAVED / already-saved / error / current unread count)
- Duplicate protection — the same URL is never saved twice
- Each article is stored under its own `chrome.storage.sync` key (with a small index key for ordering) rather than one combined blob, so the list isn't capped by sync's small per-key size limit

## Installation

This extension isn't published on the Chrome Web Store — load it as an unpacked developer extension:

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this project folder.
4. The book-plus icon appears in Chrome's toolbar (it may be tucked inside the puzzle-piece "Extensions" menu at first — click the puzzle piece and pin it for one-click access).

## Usage guide

### 1. The toolbar icon — view your list

Click the book-plus icon next to the address bar to open your reading list in a popup — search it, mark items read, delete them, or save the page you're currently on.

| Action | What happens |
|---|---|
| **Left-click** | Opens the reading list popup: a search bar, your saved articles, and a **"Save Current Page"** button up top. |
| **Right-click** | Opens Chrome's normal icon menu, plus an added item: **"Open Reading List Manager."** Click it to open that same list in its own standalone window instead — handy if you want to keep it open on screen while you browse, rather than as a popup that closes when it loses focus. |

**What the badge means** — saving from the keyboard shortcut, the right-click menu, the popup's Save button, or the on-page floating button all flash the toolbar badge briefly:

| Badge | Color | Meaning |
|---|---|---|
| `SAVED` | Green | The page was just added to your reading list. |
| `•` | Amber | That page was already on your list — nothing new was added. |
| `!` | Red | Couldn't save this page (for example, a `chrome://` page rather than a normal website). |
| `3` (count) | Indigo | The idle state — shows how many articles are currently saved. |

Each flash lasts a second or two, then the badge returns to your saved-item count automatically.

### 2. Keyboard shortcuts

| Shortcut | Does what |
|---|---|
| `Ctrl+Shift+S` | Saves the current tab, without touching the mouse. |
| `Ctrl+Shift+L` | Opens the reading list — identical to clicking the toolbar icon. |

Both are the same combo on Windows, Linux, ChromeOS, and Mac. The save shortcut intentionally avoids the letter **R**: `Shift+Ctrl/Cmd+R` is Chrome's built-in hard-refresh shortcut on every platform, so an extension can never reliably use it. If either is claimed by something else on your machine, reassign it at `chrome://extensions/shortcuts` (or click **Manage shortcuts** in Options — see below).

Saving via the shortcut gets you both the toolbar badge flash *and* an on-page toast confirming it.

> **Shortcut showing blank after updating the extension?** Chrome only auto-applies a command's default key the first time an extension is *installed* — clicking "Reload" on `chrome://extensions` after a manifest change doesn't count as a fresh install, so a newly-added command (like `Ctrl+Shift+L` if you already had an older version of this extension loaded) comes up unbound. Fix it either way: **Remove** the extension and **Load unpacked** it again from the same folder (a true reinstall — your saved articles are untouched, since `chrome.storage.sync` data is keyed to the extension's id, not the install action), or just bind it by hand via the pencil icon on `chrome://extensions/shortcuts`.

### 3. Right-click menu — save a page or a specific link

Right-click anywhere on a page (or directly on a link) to see **"Add link/page to Reading List."**

- Right-click empty space on a page → saves the page you're currently on.
- Right-click a specific link → saves *that link's URL*, without navigating to it first.

### 4. On-page toast notifications

Saving via the keyboard shortcut or the right-click menu also pops up a small toast in the bottom-right corner of the page for about two seconds — useful if you're not looking at the toolbar:

| Toast | Color | Meaning |
|---|---|---|
| "Article added!" | Green | Newly saved. |
| "Already added" | Amber | It was already on your list. |
| "Couldn't save this page" / connection error | Red | Something went wrong — try again. |

The floating save button (below) shows this same feedback directly on the button itself instead of a separate toast.

### 5. The floating save button (on-page)

Every regular web page gets a small circular button in the bottom-right corner of the screen. It always reflects the article's real saved/read state — checked automatically on page load, and kept live in sync if you save or mark it read from somewhere else (the keyboard shortcut, the right-click menu, or the Manager) while the tab stays open.

| Gesture | State / color | What happens |
|---|---|---|
| Click | Indigo → orange | Saves the page. Turns orange immediately (saved, unread). |
| Double-click | Orange ↔ spring green `#00FF7F` | Toggles read/unread, from either color, in either direction. |
| Hold for 2.5 seconds | Orange or green → indigo | Removes the page from your list. A radial ring sweeps around the button as you hold; release early and nothing happens. |
| *(automatic)* | Red alert icon, briefly | Something went wrong — reverts to the correct state on its own after ~1.5s so you can retry. |

> **Not seeing it?** A handful of sites use floating chat widgets or cookie banners in the same bottom-right corner, which can occasionally overlap the button. It's still there — try scrolling, or use the toolbar icon / keyboard shortcut instead. It can also be turned off entirely in Options (see below).

### 6. The Reading List Manager

Open it by clicking the toolbar icon (or right-clicking it → **Open Reading List Manager** for a standalone window instead of a popup). This is where you browse, search, and manage everything you've saved.

- **Search bar** — filter your saved articles by title as you type.
- **Favicon + title** — click anywhere on an item to open it in a new tab.
- **Domain name** — shown under the title so you can see the source at a glance.
- **Grip icon** — drag an item to manually reorder your list. Only works while the search box is empty (dragging a filtered subset wouldn't map cleanly onto the full list's order).
- **Checkmark button** — toggles an item between read and unread. Read items get a strikethrough title and a dimmed favicon.
- **Trash button** — removes the item from your list.

If your list is empty, you'll see a prompt to save your first page. If a search doesn't match anything, you'll see a "no matches" message instead of an empty list.

### 7. Options — entry points, shortcuts & data

Open Options by clicking the gear icon in the popup (next to "Save Current Page"), or by right-clicking the toolbar icon → **Options**.

**Entry points**
- **On-page floating save button** — turn off if you don't want the bubble appearing on every page.
- **Right-click "Add to Reading List" menu** — turn off to remove that item from the page/link right-click menu.

Toggle changes apply immediately, even to tabs already open — no reload needed. The toolbar icon, both keyboard shortcuts, and right-click → *Open Reading List Manager* are unaffected by these toggles; they're always available.

**Keyboard shortcut**
- **Manage shortcuts button** — opens Chrome's own `chrome://extensions/shortcuts` page directly, where you can view or rebind either shortcut.

**Your data**
- **Export as JSON** — downloads the full reading list as a single JSON file, for backup or moving to another browser/computer.
- **Import** — accepts that same JSON format, or a Pocket CSV export (`title,url,time_added,tags,status`). Duplicate URLs are skipped automatically, so re-importing the same file is safe; you'll see a summary like "1 added, 1 skipped."

### 8. Duplicate protection & syncing

- Saving the same URL twice won't create a second entry — the toolbar badge, the on-page toast, and the floating button all show an amber "already added" indicator instead of a green one.
- Your reading list is stored with Chrome's built-in sync storage, so it follows you to any other computer signed into the same Google account with Chrome sync turned on.
- Each article is stored separately under the hood (rather than one big combined record), so one long title or an unusually large favicon on a single article won't affect any of your other saved articles.

### 9. Quick reference

| I want to... | Do this |
|---|---|
| Save the page I'm on right now | Press `Ctrl+Shift+S`, click the floating button on the page, or open the toolbar popup and click *Save Current Page* |
| Save a link without opening it | Right-click the link → *Add link/page to Reading List* |
| View / search my saved articles | Press `Ctrl+Shift+L`, click the toolbar icon, or right-click it → *Open Reading List Manager* for a separate window |
| Mark something as read | Double-click the floating button on the page, or click the checkmark in the manager |
| Remove a saved article | Hold the floating button for 2.5 seconds, or click the trash icon in the manager |
| Reorder my saved articles | Drag an item by its grip icon in the manager (search box must be empty) |
| Turn off the floating button or right-click menu | Open Options — gear icon in the popup, or right-click the toolbar icon → *Options* |
| View or rebind a keyboard shortcut | Open Options → *Manage shortcuts*, or go straight to `chrome://extensions/shortcuts` |
| Back up or move my list to another browser | Open Options → *Export as JSON* |
| Restore a backup, or import from Pocket | Open Options → *Import*, choose a Read Later JSON export or a Pocket CSV export |

## Project structure

```
manifest.json     — Manifest V3 config: permissions, action, commands, content_scripts, options_ui
background.js     — service worker: badge, context menus, keyboard command, message handling
storage.js         — chrome.storage.sync data layer (shared by background.js, popup.js, options.js)
popup.html/js      — the reading list popup / standalone manager window
options.html/js    — the options page (entry-point toggles, shortcut link, export/import)
content.js/css     — the on-page floating save button and toast, injected on every http/https page
icons/             — toolbar and extension icons
```

## Permissions used

| Permission | Why |
|---|---|
| `storage` | Save the reading list via `chrome.storage.sync` |
| `activeTab` / `tabs` | Read the current tab's URL, title, and favicon to save it |
| `contextMenus` | The right-click "Add link/page" and "Open Reading List Manager" menu items |
| `notifications` | A one-time nudge on install to pin the extension to the toolbar (Chrome doesn't allow extensions to pin themselves) |

## License

MIT © 2026 Karan Changlani — see [LICENSE](LICENSE). Free to use, modify, and distribute, as long as the original copyright notice stays attached.
