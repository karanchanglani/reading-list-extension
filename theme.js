// Applies the user's Light/Dark/System theme choice to whichever extension
// page includes this script — self-contained, no per-page wiring needed
// beyond a single <script type="module" src="theme.js"> tag. Independent of
// each page's own script (popup.js, options.js, reader.js): those manage
// their own settings for their own purposes, this only ever touches the
// data-theme attribute the CSS in each page keys off of.

import { getSettings, SETTINGS_KEY } from "./storage.js";

/** @param {import("./storage.js").Theme} theme */
function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

getSettings().then((settings) => applyTheme(settings.theme));

// Picks up a theme change made from Options (or another tab of the same
// page) while this page stays open, same live-update pattern used
// elsewhere for settings (e.g. content.js's fabEnabled listener).
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes[SETTINGS_KEY]) return;
  applyTheme(changes[SETTINGS_KEY].newValue.theme);
});
