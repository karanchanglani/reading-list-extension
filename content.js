(function () {
  // Guard against double-injection (e.g. the extension reloading mid-session).
  if (document.getElementById("read-later-fab")) return;

  const ERROR_RESET_MS = 1500;
  const TOAST_MS = 2200;
  const SETTINGS_KEY = "settings";
  const DEFAULT_SETTINGS = { fabEnabled: true, contextMenuEnabled: true };

  const ICON_DEFAULT = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="13" height="18" rx="2"></rect>
      <line x1="7" y1="3" x2="7" y2="21"></line>
      <line x1="20" y1="6" x2="20" y2="14"></line>
      <line x1="16" y1="10" x2="24" y2="10"></line>
    </svg>`;

  const ICON_CHECK = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="4 12 9 17 20 6"></polyline>
    </svg>`;

  const ICON_ERROR = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9"></circle>
      <line x1="12" y1="8" x2="12" y2="13"></line>
      <circle cx="12" cy="16.5" r="1" style="fill:currentColor;stroke:none"></circle>
    </svg>`;

  /** @type {HTMLButtonElement | null} */
  let fab = null;
  let resetTimer = null;

  function mountFab() {
    if (fab) return;

    fab = document.createElement("button");
    fab.id = "read-later-fab";
    fab.type = "button";
    fab.innerHTML = ICON_DEFAULT;
    setLabel("Save this page to Read Later");

    fab.addEventListener("click", () => {
      if (fab.disabled || fab.classList.contains("rl-busy")) return;

      fab.classList.add("rl-busy");
      if (resetTimer) clearTimeout(resetTimer);

      chrome.runtime.sendMessage(
        {
          action: "ADD_TO_READING_LIST",
          payload: {
            url: location.href,
            title: document.title,
            favIconUrl: getFaviconUrl(),
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            // Most commonly: the extension was reloaded/updated and this
            // content script's connection to the background worker is stale.
            showTransientError("Couldn't reach Read Later — try refreshing the page.");
            return;
          }
          if (response?.ok) {
            setSavedState(response.added ? "new" : "existing");
          } else {
            showTransientError(response?.error || "Couldn't save this page.");
          }
        }
      );
    });

    document.documentElement.appendChild(fab);

    // Find out up front whether this page is already saved, so the button
    // renders disabled from the start instead of only after a wasted click.
    chrome.runtime.sendMessage({ action: "CHECK_IS_SAVED", url: location.href }, (response) => {
      if (chrome.runtime.lastError) return; // background not reachable — leave it enabled
      if (response?.ok && response.saved) setSavedState("existing");
    });
  }

  function unmountFab() {
    if (!fab) return;
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
    fab.remove();
    fab = null;
  }

  /**
   * Locks (or unlocks) the button into a permanent state. No-ops if the
   * button isn't currently mounted (the floating button setting is off).
   * @param {false | "new" | "existing"} state
   *   false — not saved, normal clickable button.
   *   "new" — just saved by this click (green).
   *   "existing" — was already on the list before this (amber).
   */
  function setSavedState(state) {
    if (!fab) return;
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
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

  /** Shows a red error state briefly, then returns to the normal clickable button. */
  function showTransientError(message) {
    if (!fab) return;
    fab.classList.remove("rl-saved", "rl-already-saved");
    fab.disabled = false;
    fab.classList.add("rl-error");
    fab.innerHTML = ICON_ERROR;
    setLabel(message);

    resetTimer = setTimeout(() => {
      if (!fab) return;
      fab.classList.remove("rl-error", "rl-busy");
      fab.innerHTML = ICON_DEFAULT;
      setLabel("Save this page to Read Later");
    }, ERROR_RESET_MS);
  }

  function setLabel(text) {
    fab.setAttribute("aria-label", text);
    fab.title = text;
  }

  function getFaviconUrl() {
    const link =
      document.querySelector('link[rel~="icon"][href]') ||
      document.querySelector('link[rel="shortcut icon"][href]');
    return link?.href || `${location.origin}/favicon.ico`;
  }

  // Toast for entry points with no on-page feedback of their own (the
  // keyboard shortcut, the right-click "Add link/page" menu item) — the FAB
  // above already shows its own inline confirmation, so it doesn't need this.
  let toastEl = null;
  let toastHideTimer = null;

  function showToast(message, kind = "saved") {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "read-later-toast";
      document.documentElement.appendChild(toastEl);
    }

    toastEl.textContent = message;
    toastEl.className = `rl-toast-${kind}`;
    // Force a reflow so re-triggering the fade-in works even if a toast is
    // already visible (e.g. two saves in quick succession).
    void toastEl.offsetWidth;
    toastEl.classList.add("rl-visible");

    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => {
      toastEl.classList.remove("rl-visible");
    }, TOAST_MS);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== "SHOW_TOAST") return;
    showToast(message.text, message.kind);
    if (message.kind === "saved") setSavedState("new");
    else if (message.kind === "info") setSavedState("existing");
  });

  // Respect the "on-page floating save button" option, and react live if
  // it's toggled from the options page while this tab stays open.
  chrome.storage.sync.get(SETTINGS_KEY, (result) => {
    if (chrome.runtime.lastError) {
      mountFab(); // couldn't read settings — default to on
      return;
    }
    const settings = { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
    if (settings.fabEnabled) mountFab();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[SETTINGS_KEY]) return;
    const settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) };
    if (settings.fabEnabled) mountFab();
    else unmountFab();
  });
})();
