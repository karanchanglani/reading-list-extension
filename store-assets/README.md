# Store assets

Screenshots for the Chrome Web Store listing (roadmap item 2's remaining
scope, once the icon itself was kept as final rather than swapped for a new
design). These are marketing/listing assets, not referenced anywhere in the
extension itself — upload them directly through the Web Store Developer
Dashboard when you submit.

- `screenshots/01-reading-list-manager.png` — the popup/manager view with a
  sample reading list (tags, read/unread state, search, sort).
- `screenshots/02-floating-save-button.png` — the on-page floating save
  button in its saved (orange) state on a real article page.

Both are exactly 1280×800, one of the two sizes the Store accepts.

Regenerate them any time the UI changes enough to make these stale:

```
node scripts/generate-screenshots.js
```

The promo tiles the Store also accepts (440×280 small tile, 1400×560
marquee) are optional — skipped here since they're only used if Google
chooses to feature a listing, not required to publish one.
