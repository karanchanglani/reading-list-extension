(function () {
  // Guard against double-injection (e.g. the extension reloading mid-session).
  if (document.getElementById("read-later-fab")) return;

  const ERROR_RESET_MS = 1500;
  const TOAST_MS = 2200;
  const HOLD_MS = 2500;
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
  /** @type {HTMLSpanElement | null} */
  let iconEl = null;
  /** @type {HTMLSpanElement | null} */
  let holdRing = null;
  let resetTimer = null;

  /** The id of the reading-list item for this URL, once known; null if not saved. */
  let savedItemId = null;
  let currentReadStatus = false;

  /** Set while a hold-to-remove gesture is in progress; cancels it on early release. */
  let cancelHold = null;
  /** Set right when a hold completes, so the trailing "click" it also fires is ignored. */
  let suppressNextClick = false;

  function isSavedState() {
    return fab?.classList.contains("rl-unread") || fab?.classList.contains("rl-read");
  }

  function mountFab() {
    if (fab) return;

    fab = document.createElement("button");
    fab.id = "read-later-fab";
    fab.type = "button";

    iconEl = document.createElement("span");
    iconEl.className = "rl-icon";
    iconEl.innerHTML = ICON_DEFAULT;

    holdRing = document.createElement("span");
    holdRing.className = "rl-hold-ring";
    holdRing.setAttribute("aria-hidden", "true");

    fab.append(holdRing, iconEl);
    setLabel(chrome.i18n.getMessage("fabLabelDefault"));

    // Single click: only saves when not already saved. Once saved (orange
    // or green), clicking does nothing — double-click toggles read status,
    // holding it for 2.5 seconds removes it.
    fab.addEventListener("click", () => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      if (isSavedState() || fab.classList.contains("rl-busy")) return;
      saveCurrentPage();
    });

    // Double-click (click it twice): toggles read/unread, orange <-> green.
    fab.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (!isSavedState() || fab.classList.contains("rl-busy")) return;
      toggleReadStatus();
    });

    // Press and hold for 2.5s (only while saved) to remove it from the list.
    fab.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return; // left button / primary touch only
      if (!isSavedState() || fab.classList.contains("rl-busy")) return;
      startHold();
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((type) => {
      fab.addEventListener(type, () => cancelHold?.());
    });

    document.documentElement.appendChild(fab);

    // Find out up front whether this page is already saved (and read or
    // not), so the button renders its real state from the start instead of
    // only finding out after a wasted click.
    chrome.runtime.sendMessage({ action: "CHECK_IS_SAVED", url: location.href }, (response) => {
      if (chrome.runtime.lastError) return; // background not reachable — leave it as "not saved"
      if (response?.ok && response.saved) {
        savedItemId = response.id;
        currentReadStatus = Boolean(response.readStatus);
        setSavedState(currentReadStatus ? "read" : "unread");
      }
    });
  }

  function unmountFab() {
    if (!fab) return;
    cancelHold?.();
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
    fab.remove();
    fab = null;
    iconEl = null;
    holdRing = null;
  }

  /** Starts the 2.5s hold-to-remove countdown, animating the radial progress ring. */
  function startHold() {
    const startedAt = performance.now();
    fab.classList.add("rl-holding");
    let rafId = requestAnimationFrame(tick);

    function tick(now) {
      const progress = Math.min((now - startedAt) / HOLD_MS, 1);
      fab.style.setProperty("--rl-hold-progress", progress.toFixed(3));
      if (progress >= 1) {
        cancelHold = null;
        fab.classList.remove("rl-holding");
        suppressNextClick = true;
        unsaveCurrentPage();
      } else {
        rafId = requestAnimationFrame(tick);
      }
    }

    cancelHold = () => {
      cancelAnimationFrame(rafId);
      fab.classList.remove("rl-holding");
      fab.style.setProperty("--rl-hold-progress", "0");
      cancelHold = null;
    };
  }

  function saveCurrentPage() {
    fab.classList.add("rl-busy");
    if (resetTimer) clearTimeout(resetTimer);

    chrome.runtime.sendMessage(
      {
        action: "ADD_TO_READING_LIST",
        payload: {
          url: location.href,
          title: document.title,
          favIconUrl: getFaviconUrl(),
          snapshot: extractArticleSnapshot(),
        },
      },
      (response) => {
        fab.classList.remove("rl-busy");
        if (chrome.runtime.lastError) {
          // Most commonly: the extension was reloaded/updated and this
          // content script's connection to the background worker is stale.
          showTransientError(chrome.i18n.getMessage("fabErrorUnreachable"));
          return;
        }
        if (response?.ok) {
          savedItemId = response.item.id;
          currentReadStatus = Boolean(response.item.readStatus);
          setSavedState(currentReadStatus ? "read" : "unread");
          if (response.added && response.usage?.isNearLimit) {
            setLabel(chrome.i18n.getMessage("fabLabelSavedNearLimit", [String(response.usage.percentUsed)]));
          }
        } else {
          showTransientError(response?.error || chrome.i18n.getMessage("fabErrorSaveFailed"));
        }
      }
    );
  }

  function toggleReadStatus() {
    if (!savedItemId) return;
    const nextReadStatus = !currentReadStatus;
    fab.classList.add("rl-busy");

    chrome.runtime.sendMessage(
      { action: "TOGGLE_READ_STATUS", id: savedItemId, readStatus: nextReadStatus },
      (response) => {
        fab.classList.remove("rl-busy");
        if (chrome.runtime.lastError || !response?.ok) {
          showTransientError(chrome.i18n.getMessage("fabErrorUpdateReadStatus"));
          return;
        }
        currentReadStatus = nextReadStatus;
        setSavedState(currentReadStatus ? "read" : "unread");
      }
    );
  }

  /** Removes the current page from the reading list (triggered by the 2.5s hold). */
  function unsaveCurrentPage() {
    if (!savedItemId) return;
    fab.classList.add("rl-busy");

    chrome.runtime.sendMessage({ action: "REMOVE_FROM_READING_LIST", id: savedItemId }, (response) => {
      fab.classList.remove("rl-busy");
      if (chrome.runtime.lastError || !response?.ok) {
        showTransientError(chrome.i18n.getMessage("fabErrorRemoveFailed"));
        return;
      }
      savedItemId = null;
      currentReadStatus = false;
      setSavedState(false);
    });
  }

  /**
   * @param {false | "unread" | "read"} state
   *   false   — not saved, normal clickable button (indigo).
   *   "unread"— saved, unread (orange). Double-click marks it read.
   *   "read"  — saved, read (spring green). Double-click marks it unread.
   */
  function setSavedState(state) {
    if (!fab) return;
    cancelHold?.();
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
    fab.classList.remove("rl-busy", "rl-error", "rl-unread", "rl-read");

    if (state === "unread") {
      fab.classList.add("rl-unread");
      iconEl.innerHTML = ICON_CHECK;
      setLabel(chrome.i18n.getMessage("fabLabelUnread"));
    } else if (state === "read") {
      fab.classList.add("rl-read");
      iconEl.innerHTML = ICON_CHECK;
      setLabel(chrome.i18n.getMessage("fabLabelRead"));
    } else {
      iconEl.innerHTML = ICON_DEFAULT;
      setLabel(chrome.i18n.getMessage("fabLabelDefault"));
    }
  }

  /** Shows a red error state briefly, then reverts to whatever the real saved state is. */
  function showTransientError(message) {
    if (!fab) return;
    fab.classList.remove("rl-unread", "rl-read", "rl-busy");
    fab.classList.add("rl-error");
    iconEl.innerHTML = ICON_ERROR;
    setLabel(message);

    resetTimer = setTimeout(() => {
      setSavedState(savedItemId ? (currentReadStatus ? "read" : "unread") : false);
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

  const READING_WPM = 200;

  /**
   * Extracts a readable snapshot of the current page via Readability (see
   * vendor/readability.js), for the Reader View. Returns null — a normal,
   * expected outcome, not an error — if extraction isn't possible: the
   * library failed to load, the page has no clear "article" content (e.g. a
   * search results page, a dashboard), or parsing throws. Callers treat a
   * null snapshot the same as any other save: the URL/title/favicon still
   * get saved either way, just without a cached reader view.
   * @returns {import("./content-cache.js").ArticleSnapshot | null}
   */
  function extractArticleSnapshot() {
    if (typeof Readability !== "function") return null;

    try {
      // Readability mutates the document it's given (strips elements as it
      // works), so parse a clone rather than the live page the user is
      // reading and might still be interacting with.
      const clone = document.cloneNode(true);
      const article = new Readability(clone).parse();
      if (!article?.content || !article.textContent?.trim()) return null;

      const wordCount = article.textContent.trim().split(/\s+/).length;

      return {
        title: article.title || document.title,
        byline: article.byline || null,
        siteName: article.siteName || null,
        content: article.content,
        textContent: article.textContent,
        excerpt: article.excerpt || "",
        length: article.length || article.textContent.length,
        readingTimeMinutes: Math.max(1, Math.round(wordCount / READING_WPM)),
        cachedAt: Date.now(),
      };
    } catch (error) {
      console.error("[Read Later] Article extraction failed:", error);
      return null;
    }
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
    if (!fab) return; // FAB disabled via settings — toast still shows, nothing else to update

    if (message.kind === "saved" || message.kind === "info") {
      if (message.id) savedItemId = message.id;
      currentReadStatus = Boolean(message.readStatus);
      setSavedState(currentReadStatus ? "read" : "unread");
    }
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
