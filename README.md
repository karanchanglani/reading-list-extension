# Read Later

A Chrome extension (Manifest V3) for saving articles to a reading list without leaving the page you're on. Save from the toolbar popup, a keyboard shortcut, a right-click menu, or a floating button injected on every page — then browse, search, mark items read, and delete them from a dedicated reading list manager. The list is backed by `chrome.storage.sync`, so it follows you to any other computer signed into the same Google account with Chrome sync turned on.

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [How to use it](#how-to-use-it)
- [Implementation](#implementation)
  - [1. Manifest V3 configuration](#1-manifest-v3-configuration)
  - [2. Storage layer — dodging the sync quota trap](#2-storage-layer--dodging-the-sync-quota-trap)
  - [3. Background service worker](#3-background-service-worker)
  - [4. Content script — the floating action button](#4-content-script--the-floating-action-button)
  - [5. Popup — search, list, and the manager window](#5-popup--search-list-and-the-manager-window)
- [Project structure](#project-structure)
- [Permissions used](#permissions-used)
- [License](#license)

## Features

- **Toolbar popup** — click the icon to see your full list: live search-by-title, mark as read/unread, delete, and a "Save Current Page" button
- **Keyboard shortcut** — `Ctrl+Shift+S` on every platform (Windows, Linux, ChromeOS, Mac) saves the active tab instantly, with an on-page toast confirmation
- **Right-click context menu** — "Add link/page to Reading List" works on the page itself *or* on a specific link, without navigating to it
- **Right-click the toolbar icon** → "Open Reading List Manager" opens the same list in a standalone window instead of an anchored popup
- **Floating save button** injected on every `http`/`https` page, with a real state machine: not-saved → just-saved (green) / already-saved (amber) → locked, so it always reflects whether *this* page is actually on your list
- **On-page toast notifications** for the keyboard shortcut and right-click save (the FAB shows its own inline feedback instead)
- **Toolbar badge feedback** — green `SAVED`, amber `•` for duplicates, red `!` for errors, otherwise your saved-item count
- **Duplicate protection** — URLs are normalized (trailing slash / `#fragment` stripped) before comparing, so the same article is never saved twice
- **Per-item sync storage** — each article lives under its own `chrome.storage.sync` key instead of one combined blob, avoiding the ~8KB per-key quota that a single-array approach would hit
- **One-time install nudge** via `chrome.notifications` reminding you to pin the extension (Chrome doesn't let extensions pin themselves)
- **MIT licensed**

## Installation

Not on the Chrome Web Store — load it as an unpacked developer extension:

1. Clone this repo (or download it as a ZIP and unzip it).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.
5. The book-plus icon appears in the toolbar — click the puzzle-piece icon and pin it for one-click access.

## How to use it

### The toolbar icon

| Action | What happens |
|---|---|
| **Left-click** | Opens the reading list popup — search, your saved articles, and a **Save Current Page** button. |
| **Right-click** | Chrome's normal icon menu, plus **"Open Reading List Manager"** — opens the same list in its own window. |

### Keyboard shortcut

**`Ctrl+Shift+S`** saves the current tab instantly. This deliberately avoids the letter **R** — `Shift+Ctrl/Cmd+R` is Chrome's hard-refresh shortcut on every platform, so an extension can never reliably claim it. Reassign at `chrome://extensions/shortcuts` if it's taken by something else.

### Right-click menu

Right-click a page or a link → **"Add link/page to Reading List."** On a link, it saves that link's URL without opening it.

### The floating save button

Appears bottom-right on every page, and reflects the page's actual saved state:

| State | Look |
|---|---|
| Not saved | Indigo, book-plus icon, clickable |
| Just saved | Green checkmark, locked |
| Already saved | Amber checkmark, locked |
| Error | Red alert icon, auto-resets after ~1.5s |

### The Reading List Manager

Search by title, click an item to open it in a new tab, toggle read/unread, or delete it.

## Implementation

### 1. Manifest V3 configuration

Permissions, the toolbar popup, the keyboard command, and the content script that gets injected on every page:

```json
{
  "manifest_version": 3,
  "name": "Read Later",
  "permissions": ["storage", "activeTab", "tabs", "contextMenus", "notifications"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "commands": {
    "quick-save": {
      "suggested_key": {
        "default": "Ctrl+Shift+S",
        "mac": "MacCtrl+Shift+S"
      },
      "description": "Save the current page to your Read Later list"
    }
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "css": ["content.css"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

`"type": "module"` on the service worker lets `background.js` `import` the storage layer as an ES module. `MacCtrl+Shift+S` (not `Command+Shift+S`) keeps the shortcut on the literal physical Control key on Mac too, matching Windows/Linux exactly.

### 2. Storage layer — dodging the sync quota trap

`chrome.storage.sync` caps **any single key** at ~8KB (`QUOTA_BYTES_PER_ITEM`). An early version stored the whole list as one JSON array under one key — so the real capacity was "however many articles fit in 8KB total," and every save silently started failing once the array crossed that line. The fix: one `chrome.storage.sync` key per article, plus a small index key for ordering, so the only thing that ever has to fit in 8KB is a single article's metadata:

```js
export const INDEX_KEY = "readingListIndex";
const ITEM_KEY_PREFIX = "item_";

function itemKey(id) {
  return `${ITEM_KEY_PREFIX}${id}`;
}

export async function addToReadingList(source) {
  if (!source?.url || !/^https?:/i.test(source.url)) {
    throw new Error("Only http(s) pages can be saved.");
  }

  const ids = await getIndex();
  const existingItems = await getItemsByIds(ids);

  const existing = findByUrl(existingItems, source.url);
  if (existing) {
    return { added: false, item: existing, list: existingItems };
  }

  const item = createReadingListItem(source);

  await chrome.storage.sync.set({
    [INDEX_KEY]: [item.id, ...ids],
    [itemKey(item.id)]: item,
  });

  return { added: true, item, list: [item, ...existingItems] };
}
```

A `migrateLegacyStorage()` function runs once on install/update to fan out anything still sitting in the old single-blob key into the new per-item format, so nothing already saved gets lost when upgrading.

Duplicate detection normalizes the URL first (strips a trailing slash and any `#fragment`) so cosmetically different URLs for the same page still count as the same article:

```js
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function findByUrl(items, url) {
  const target = normalizeUrl(url);
  return items.find((item) => normalizeUrl(item.url) === target);
}
```

### 3. Background service worker

**Badge flashing** — a token-based approach so overlapping flashes (e.g. a context-menu save firing right after a keyboard-shortcut save) can't clobber each other's revert-to-idle timer:

```js
let flashCounter = 0;
let activeFlashToken = 0;

function flashBadge(text, color, ms = BADGE_FLASH_MS) {
  const token = ++flashCounter;
  activeFlashToken = token;

  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });

  setTimeout(() => {
    if (activeFlashToken === token) {
      activeFlashToken = 0;
      renderCountBadge();
    }
  }, ms);
}
```

**One shared save path** for every non-popup trigger (keyboard shortcut, right-click menu) — badge flash plus an in-page toast sent to the tab that triggered it:

```js
async function quickSave(source, tabId) {
  try {
    const { added } = await addToReadingList(source);
    if (added) {
      flashBadge(BADGE_SUCCESS_TEXT, BADGE_SUCCESS_COLOR);
      notifyTab(tabId, "Article added!", "saved");
    } else {
      flashBadge("•", BADGE_INFO_COLOR);
      notifyTab(tabId, "Already added", "info");
    }
  } catch (error) {
    flashBadge("!", BADGE_ERROR_COLOR);
    notifyTab(tabId, "Couldn't save this page", "error");
  }
}
```

**Context menus** register two items — one for right-clicking a page/link, one for right-clicking the toolbar icon itself (`contexts: ["action"]`):

```js
function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    createMenuItem({
      id: ADD_MENU_ID,
      title: "Add link/page to Reading List",
      contexts: ["page", "link"],
    });
    createMenuItem({
      id: MANAGER_MENU_ID,
      title: "Open Reading List Manager",
      contexts: ["action"],
    });
  });
}
```

**The keyboard command** reuses the tab Chrome hands it directly (Chrome 96+), falling back to a query only if that's missing:

```js
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== QUICK_SAVE_COMMAND) return;

  if (tab) {
    quickSaveTab(tab);
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
      quickSaveTab(activeTab);
    });
  }
});
```

**A `CHECK_IS_SAVED` message handler** lets the content script ask, on page load, whether the current URL is already on the list — this is what lets the floating button render disabled immediately instead of only after a wasted click:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== "CHECK_IS_SAVED") return false;

  getReadingList()
    .then((items) => {
      sendResponse({ ok: true, saved: Boolean(findByUrl(items, message.url)) });
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true; // keep the message channel open for the async response
});
```

### 4. Content script — the floating action button

The button is a small state machine with three locked states, driven from both its own click handler and messages from the background script:

```js
/**
 * @param {false | "new" | "existing"} state
 *   false     — not saved, normal clickable button
 *   "new"     — just saved by this click (green)
 *   "existing"— was already on the list before this (amber)
 */
function setSavedState(state) {
  fab.classList.remove("rl-busy", "rl-error", "rl-saved", "rl-already-saved");

  if (state === "new") {
    fab.classList.add("rl-saved");
    fab.disabled = true;
    fab.innerHTML = ICON_CHECK;
    setLabel("Saved to Read Later!");
  } else if (state === "existing") {
    fab.classList.add("rl-already-saved");
    fab.disabled = true;
    fab.innerHTML = ICON_CHECK;
    setLabel("Already in your Read Later list");
  } else {
    fab.disabled = false;
    fab.innerHTML = ICON_DEFAULT;
    setLabel("Save this page to Read Later");
  }
}

// Checked once on load, so the button starts disabled if it's already saved.
chrome.runtime.sendMessage({ action: "CHECK_IS_SAVED", url: location.href }, (response) => {
  if (chrome.runtime.lastError) return;
  if (response?.ok && response.saved) setSavedState("existing");
});

// Also flips state when a save happens elsewhere (keyboard shortcut, right-click menu).
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== "SHOW_TOAST") return;
  showToast(message.text, message.kind);
  if (message.kind === "saved") setSavedState("new");
  else if (message.kind === "info") setSavedState("existing");
});
```

All of the button's icons (book-plus, checkmark, alert) are hand-authored inline SVG built from `rect`/`line`/`polyline` primitives — no icon library or external asset needed.

### 5. Popup — search, list, and the manager window

The same `popup.html`/`popup.js` serves two roles: the toolbar dropdown *and* the standalone "Reading List Manager" window (opened via `chrome.windows.create` from the right-click menu). Search is a simple client-side filter over the already-fetched list — no extra storage reads per keystroke:

```js
function getFilteredItems() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return allItems;
  return allItems.filter((item) => (item.title || "").toLowerCase().includes(query));
}
```

## Project structure

```
manifest.json     Manifest V3 config: permissions, action, commands, content_scripts
background.js     Service worker: badge, context menus, keyboard command, messaging
storage.js         chrome.storage.sync data layer (shared by background.js and popup.js)
popup.html/js      The reading list popup / standalone manager window
content.js/css     The on-page floating save button + toast, injected on every http/https page
icons/             Toolbar and extension icons
```

## Permissions used

| Permission | Why |
|---|---|
| `storage` | Save the reading list via `chrome.storage.sync` |
| `activeTab` / `tabs` | Read the current tab's URL, title, and favicon to save it |
| `contextMenus` | The right-click "Add link/page" and "Open Reading List Manager" menu items |
| `notifications` | A one-time nudge on install to pin the extension to the toolbar |

## License

MIT © 2026 Karan Changlani — see [LICENSE](LICENSE). Free to use, modify, and distribute, as long as the original copyright notice stays attached.
