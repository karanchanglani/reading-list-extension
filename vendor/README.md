# vendor/

Third-party code, vendored as plain scripts (no build step in this project) rather than installed via npm.

- **readability.js** — [@mozilla/readability](https://github.com/mozilla/readability), Apache-2.0 (`READABILITY_LICENSE.md`). Extracts a clean, readable snapshot of an article's content — the same library behind Firefox's Reader View. Loaded as a plain content script (defines the global `Readability` class), used by `content.js` to build the cached snapshot saved when you save a page via the floating button.

To update: re-copy `Readability.js` from a fresh `npm install @mozilla/readability` and overwrite this file — it has no build step of its own.
