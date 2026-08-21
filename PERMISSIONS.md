# Permission audit

Roadmap Tier 1, item 3. Every permission the extension requests, why it's needed, and — for
`tabs` specifically — why it was removed. Written to be pasted directly into the Chrome Web
Store listing's permission-justification fields.

## What's requested

```json
"permissions": ["storage", "activeTab", "contextMenus", "notifications"]
```

| Permission | Why |
|---|---|
| `storage` | Persists the reading list (`chrome.storage.sync`) and cached article snapshots for Reader view (`chrome.storage.local`). |
| `activeTab` | Reads the current tab's URL, title, and favicon at the moment the user saves a page — via the toolbar icon, a keyboard shortcut, or the right-click menu. Grants access only to the one tab the user just acted on, only for that action, with no persistent background access. |
| `contextMenus` | Adds the right-click "Add link/page to Read Later" and "Open Reading List Manager" items. |
| `notifications` | A single one-time nudge on install suggesting the user pin the toolbar icon (Chrome doesn't let an extension pin itself). |

Host permissions (`content_scripts.matches`) are separate from the list above and are needed
so the floating save button (`content.js`) and Readability extraction can run on the pages the
user is actually reading — not requested here.

## Why `tabs` was removed

The manifest previously requested the broad `tabs` permission alongside `activeTab`. `tabs`
grants standing read access to the URL, title, and favicon of *every* open tab, at any time —
not just the one the user is currently interacting with. `activeTab` grants the same
information, but only for the single tab that was just the target of a user gesture Chrome
recognizes (a toolbar-icon click, a `chrome.commands` shortcut, or a `contextMenus` item
click), and only until that tab navigates away. Everywhere this extension reads tab data, it's
already inside one of those three gestures, so `tabs` added standing access to browsing
activity this extension had no use for and no business asking for on a public listing.

Every `chrome.tabs.*` call site was audited:

| File : line | Call | Gated by |
|---|---|---|
| `popup.js` — `prefetchActiveTab()` | `chrome.tabs.query({active:true, currentWindow:true})` | Popup only opens on a toolbar-icon click. |
| `background.js` — `commands.onCommand` fallback | `chrome.tabs.query({active:true, currentWindow:true})` | Only runs if the command callback's own `tab` argument is missing; the command itself is a `chrome.commands` invocation. |
| `background.js` — `contextMenus.onClicked` | reads `tab.url` / `tab.title` / `tab.favIconUrl` / `tab.id` directly off the callback argument | Chrome hands this callback a fully-populated tab object as part of firing the event — no separate query, and no permission beyond `contextMenus` + `activeTab` needed. |
| `background.js` — `notifyTab()` | `chrome.tabs.sendMessage(tabId, ...)` | Messaging an already-known tab ID doesn't require `tabs` or `activeTab` at all. |
| `popup.js`, `options.js` | `chrome.tabs.create({url})` | Opening a new tab never requires `tabs` or `activeTab`. |

None of these needed standing access to tabs the user hasn't just acted on, so `tabs` was
dropped from the manifest, keeping only `activeTab`.

## How this was verified

- **Manifest validity**: parses as JSON; `web-ext lint` still runs clean (0 errors) after the
  change.
- **Automated regression**: the full Playwright suite (11 tests) passes unchanged after
  removing `tabs`, including tests that open the popup and reader view, exercise the FAB save
  flow, and round-trip export/import. None of these depend on standing multi-tab access, so a
  clean pass is consistent with — though doesn't by itself *prove* — the permission removal
  being safe.
- **Not automated, and why**: Playwright's extension harness opens `popup.html` as an ordinary
  new tab (`context.newPage()` + `page.goto(...)`), not as a genuine toolbar-anchored popup.
  Chrome's `chrome.tabs.query({currentWindow:true})` resolution — and the specific gesture that
  qualifies as "the user just clicked the action" — behaves differently for a real anchored
  popup than for a page opened by navigating a new tab to the same URL. That gap already existed
  before this change (it's why the Manager window's own "Save current page" affordance is
  disabled in tests) and isn't something this test harness can close. The same applies to the
  keyboard-shortcut and native right-click-menu paths, which depend on OS/browser-level
  gestures Playwright doesn't drive.

  Recommended manual check before/around a Chrome Web Store submission: load the unpacked
  extension, click the toolbar icon on a real page and confirm the popup's Save button captures
  that page (not a blank/wrong tab), then repeat via the keyboard shortcut and the right-click
  menu.
