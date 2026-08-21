# Firefox compatibility audit

Roadmap Tier 4, item 15. This documents what was checked, what was changed, what was verified and how, and what's still unverified.

## What changed

**`manifest.json`**
- `background` now specifies both `service_worker` (Chrome) and `scripts` (Firefox), pointing at the same `background.js`. Chrome uses the former and ignores the latter; Firefox does the reverse. `"type": "module"` applies to both, so `background.js`'s existing `import` statements need no changes.
- Added `browser_specific_settings.gecko`: a stable add-on `id` (required for Firefox to sign/install a Manifest V3 extension at all — AMO doesn't assign one for you), `strict_min_version: "142.0"`, and `data_collection_permissions: { required: ["none"] }`.

**`reader.js`** — while auditing, `web-ext lint` flagged an `innerHTML` assignment that turned out to be a real bug, not a false positive: the "no cached content, here's a link to the live page" state built an `<a href="...">` by string-interpolating `item.url` directly into HTML. That field can come from an **imported file** (JSON or Pocket CSV), not just a trusted `location.href` — a URL containing a literal `"` could break out of the `href` attribute and inject arbitrary HTML/attributes. Fixed by building the link via `document.createElement` (a safe `.href` assignment can never be interpreted as HTML) and reading back `.outerHTML`, which the browser serializes with correct escaping. Added `tests/security.spec.js`, which imports a URL crafted with an embedded `<img onerror=...>` payload and confirms nothing executes — verified it actually fails against the pre-fix code before confirming it passes against the fix, not just written to trivially pass.

## What was deliberately *not* changed

**`webextension-polyfill` was not added.** Its usual purpose is letting code written against the promise-based `browser.*` API also run in Chrome, which historically only had callback-based `chrome.*`. This codebase already uses `chrome.*` exclusively, with promises, everywhere — and Chrome has supported promise-returning `chrome.*` calls natively since MV3, while Firefox has supported a `chrome.*` compatibility alias (including callback-style calls, for the handful of spots like `chrome.contextMenus.create(options, callback)` that still use one) for years. Adding the polyfill would mean carrying an extra dependency to solve a mismatch this code doesn't actually have. If a real Firefox-specific `chrome.*` API gap turns up in manual testing, worth revisiting — but not preemptively.

## How this was verified

Three independent methods, in increasing order of how "real" the confirmation is:

1. **Research against current, dated sources** (not just training-data recall, which is exactly the kind of thing that goes stale for a fast-moving area like this) — MDN, Bugzilla, and Mozilla's Add-ons blog, via web search. This is how the `data_collection_permissions` requirement got caught at all — it shipped in November 2025 and requires Firefox 140+, well after most general knowledge of "Firefox MV3 support" would account for.
2. **`web-ext lint`** (Mozilla's own addons-linter, the same tool AMO submission runs) against the actual manifest — added permanently as `npm run lint:firefox` and wired into CI (`.github/workflows/test.yml`), so a future regression here gets caught automatically, not just this once. Went from 2 errors / 23 warnings down to 0 errors / 12 warnings (11 are the `innerHTML` assignments, reviewed below; 1 is `BACKGROUND_SERVICE_WORKER_IGNORED`, which is Firefox correctly telling us it's ignoring `service_worker` in favor of `scripts` — exactly the intended fallback, not a problem).
3. **An actual Firefox launch.** Firefox is installed on this machine, so `web-ext run` loaded the real extension into a real Firefox instance via the remote debugging protocol. Log confirms `Installed /Volumes/T7/reading-list-extension as a temporary add-on` with no manifest errors — genuine proof it loads, beyond static analysis.

### The 11 remaining `UNSAFE_VAR_ASSIGNMENT` warnings, reviewed individually

All are `.innerHTML =` assignments the linter can't statically prove are safe. Each was checked by hand:
- `content.js` (5), `popup.js` (1) — assigning hand-authored, hardcoded SVG icon markup (`ICON_CHECK`, `ICON_DEFAULT`, etc.) — static strings, never touch user/page data.
- `reader.js` (2, excluding the one that got fixed) — the reading-time/byline subline (already passed through the existing `escapeHtml()` helper) and the cached article body (Readability's sanitized output — the same trust boundary Firefox's own Reader View relies on, already documented in a code comment at that call site).
- `vendor/readability.js` (2) — internal to the vendored third-party library itself, not this project's code.

## What's still unverified

- **Interactive functional testing** — clicking through actual saves, the floating button, the Manager, Options, etc. in Firefox by hand. `web-ext run` confirms the extension *installs and starts*; it doesn't confirm every feature behaves correctly, and Playwright's Firefox support doesn't extend to loading unpacked WebExtensions the way it does Chromium (no automated equivalent of the Chrome test suite in `tests/` exists for Firefox yet).
- **Firefox for Android** — `strict_min_version` covers it in principle (140/142 alignment), but nothing here has been checked against Firefox for Android specifically.
- **Actual AMO submission** — signing, review, and the real submission flow haven't been attempted. The `gecko.id` used here (`read-later@karanchanglani.dev`) is a placeholder in the correct format; it becomes a permanent identifier once actually published, so confirm/change it deliberately before a real submission rather than treating this value as final.
