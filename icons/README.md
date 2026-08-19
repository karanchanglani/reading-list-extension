# Icons

`icon16.png`, `icon32.png`, `icon48.png`, and `icon128.png` are programmatically
generated **placeholders** — a simple "book + plus" glyph on a solid indigo
background (`#4F46E5`) — sized correctly so the extension loads and looks
reasonable in the toolbar, extensions page, and Chrome Web Store listing slot.

Swap them for real design assets before shipping:

- Keep the same filenames and pixel sizes (16, 32, 48, 128) so `manifest.json`
  doesn't need to change, or update the `icons` / `action.default_icon` paths
  in `manifest.json` if you rename them.
- Export as PNG with a transparent or intentional background.
- A "book-plus" glyph (e.g. from Lucide: https://lucide.dev/icons/book-plus)
  is a good visual reference for the intended icon concept.
