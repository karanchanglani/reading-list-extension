# Read Later

A Chrome extension (Manifest V3) for saving articles to a reading list without leaving the page you're on. Save from the toolbar popup, a keyboard shortcut, a right-click menu, or a floating button that appears on every page — then browse, search, mark items read, and delete them from a dedicated reading list manager. Your list is stored with `chrome.storage.sync`, so it follows you to any other computer signed into the same Google account with Chrome sync turned on.

## Features

- One-click save from the toolbar popup, which also shows your full list with search, mark-as-read, and delete
- Keyboard shortcut (`Ctrl+Shift+S` on every platform) for instant saving, with an on-page toast confirmation
- Right-click context menu — "Add link/page to Reading List" on any page or link (also opens a standalone Reading List Manager window from the toolbar icon's right-click menu)
- A floating save button injected on every `http`/`https` page, reflecting the page's real saved state (not saved / just saved / already saved / error)
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

### 2. Keyboard shortcut

Save the current tab without touching the mouse:

**`Ctrl+Shift+S`** — the same combo on Windows, Linux, ChromeOS, and Mac.

This intentionally avoids the letter **R**: `Shift+Ctrl/Cmd+R` is Chrome's built-in hard-refresh shortcut on every platform, so an extension can never reliably use it. If `Ctrl+Shift+S` is claimed by something else on your machine, reassign it at `chrome://extensions/shortcuts`.

You'll get both the toolbar badge flash *and* an on-page toast confirming the save.

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

Every regular web page gets a small circular button in the bottom-right corner of the screen. It reflects the actual saved state of that page:

| State | Look | When |
|---|---|---|
| Not saved | Indigo, book-plus icon, clickable | Default — click it to save the page. |
| Hover | Brightens and grows slightly | Just a hover effect on the "not saved" state. |
| Just saved | Green checkmark, disabled | Right after you click it and the save succeeds. |
| Already saved | Amber checkmark, disabled | Automatically shown on page load if that article is already on your list — or if you click and it turns out to already be there. |
| Error | Red alert icon | Something went wrong. Reverts to clickable after ~1.5s so you can retry. |

Once a button shows green or amber, it's locked — clicking it again does nothing, since the article is already saved either way.

> **Not seeing it?** A handful of sites use floating chat widgets or cookie banners in the same bottom-right corner, which can occasionally overlap the button. It's still there — try scrolling, or use the toolbar icon / keyboard shortcut instead.

### 6. The Reading List Manager

Open it by clicking the toolbar icon (or right-clicking it → **Open Reading List Manager** for a standalone window instead of a popup). This is where you browse, search, and manage everything you've saved.

- **Search bar** — filter your saved articles by title as you type.
- **Favicon + title** — click anywhere on an item to open it in a new tab.
- **Domain name** — shown under the title so you can see the source at a glance.
- **Checkmark button** — toggles an item between read and unread. Read items get a strikethrough title and a dimmed favicon.
- **Trash button** — removes the item from your list.

If your list is empty, you'll see a prompt to save your first page. If a search doesn't match anything, you'll see a "no matches" message instead of an empty list.

### 7. Duplicate protection & syncing

- Saving the same URL twice won't create a second entry — the toolbar badge, the on-page toast, and the floating button all show an amber "already added" indicator instead of a green one.
- Your reading list is stored with Chrome's built-in sync storage, so it follows you to any other computer signed into the same Google account with Chrome sync turned on.
- Each article is stored separately under the hood (rather than one big combined record), so one long title or an unusually large favicon on a single article won't affect any of your other saved articles.

### 8. Quick reference

| I want to... | Do this |
|---|---|
| Save the page I'm on right now | Press `Ctrl+Shift+S`, click the floating button on the page, or open the toolbar popup and click *Save Current Page* |
| Save a link without opening it | Right-click the link → *Add link/page to Reading List* |
| View / search my saved articles | Click the toolbar icon (or right-click it → *Open Reading List Manager* for a separate window) |
| Mark something as read | Click the checkmark next to it in the manager |
| Remove a saved article | Click the trash icon next to it in the manager |

## Project structure

```
manifest.json     — Manifest V3 config: permissions, action, commands, content_scripts
background.js     — service worker: badge, context menus, keyboard command, message handling
storage.js         — chrome.storage.sync data layer (shared by background.js and popup.js)
popup.html/js      — the reading list popup / standalone manager window
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
