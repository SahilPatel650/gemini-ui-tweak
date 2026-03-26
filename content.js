/**
 * Gemini Temporary Chat Toolbar Extension
 *
 * Moves the "Temporary chat" toggle button from the sidebar into the
 * main chat toolbar (right side, next to the output-speed and dictation
 * controls) whenever a new-chat view is active.
 *
 * Google Gemini renders its UI with Angular-style custom elements.
 * Stable anchors we rely on:
 *   Sidebar button  – <button> whose aria-label contains "temporary chat"
 *                     (case-insensitive), found inside the left nav rail.
 *   Toolbar anchor  – the trailing button-group in the chat input footer,
 *                     identified by the presence of a button whose
 *                     aria-label contains "dictation" or "microphone", OR
 *                     a container that holds the model-speed selector.
 *
 * The script:
 *   1. Hides the original sidebar button.
 *   2. Clones it, strips the clone from the nav context so it fits the
 *      toolbar visually, and appends it before the first trailing button.
 *   3. Keeps the clone in sync with the sidebar state (active / inactive)
 *      via a MutationObserver.
 *   4. Tears everything down and retries whenever the page URL changes
 *      (Gemini is a SPA), so it always reflects the correct view.
 */

(function () {
  "use strict";

  const CLONE_ID = "gtu-temp-chat-btn";
  const HIDDEN_ATTR = "data-gtu-hidden";
  // Delay after an SPA navigation before re-injecting, to let the new
  // view finish rendering its toolbar and sidebar elements.
  const NAVIGATION_DELAY_MS = 500;
  // Polling interval used as a last-resort fallback for URL changes that
  // don't fire pushState/replaceState (e.g., hash-only changes).
  const POLL_INTERVAL_MS = 3000;
  // Unique namespace for extension state stored on window, to avoid
  // collisions with other scripts running on the page.
  const NS = "__geminiTempChatToolbar";

  /* ------------------------------------------------------------------ */
  /* Selector helpers                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Returns the first element whose aria-label (or textContent) contains
   * `text` (case-insensitive), starting the search from `root`.
   */
  function findByLabel(root, text) {
    const lower = text.toLowerCase();
    // Prefer aria-label match
    const byAria = Array.from(
      root.querySelectorAll("[aria-label]")
    ).find((el) => el.getAttribute("aria-label").toLowerCase().includes(lower));
    if (byAria) return byAria;
    // Fall back to text content match (buttons with icon + span)
    return Array.from(root.querySelectorAll("button, a")).find(
      (el) => el.textContent.trim().toLowerCase().includes(lower)
    ) || null;
  }

  /* ------------------------------------------------------------------ */
  /* Core move logic                                                      */
  /* ------------------------------------------------------------------ */

  function findSidebarButton() {
    // The sidebar / nav rail is usually inside a <nav> or an element with
    // role="navigation". We search document-wide and filter out our own clone.
    return Array.from(document.querySelectorAll("button, a[role='button']"))
      .find((el) => {
        if (el.id === CLONE_ID) return false;
        const label = (el.getAttribute("aria-label") || "").toLowerCase();
        const text  = (el.textContent || "").toLowerCase();
        return (
          label.includes("temporary chat") ||
          text.includes("temporary chat")
        );
      }) || null;
  }

  /**
   * Find the trailing (right-side) button container in the chat input
   * toolbar. We look for the element that contains the dictation /
   * microphone button or the model-speed control.
   */
  function findToolbarTrailingArea() {
    // Try dictation / microphone first
    const mic = findByLabel(document, "dictation") ||
                findByLabel(document, "microphone") ||
                findByLabel(document, "use microphone") ||
                findByLabel(document, "record");

    if (mic) {
      // Walk up to a flex/toolbar container that also holds other controls
      let node = mic.parentElement;
      while (node && node !== document.body) {
        if (
          node.children.length >= 2 &&
          (node.getAttribute("role") === "toolbar" ||
           node.classList.length > 0)
        ) {
          return { container: node, anchor: mic };
        }
        node = node.parentElement;
      }
      return { container: mic.parentElement, anchor: mic };
    }

    // Fallback: look for a trailing div inside the input footer
    const footer =
      document.querySelector("div[class*='input-footer']") ||
      document.querySelector("div[class*='footer-bar']") ||
      document.querySelector("div[class*='toolbar']");
    if (footer) {
      return { container: footer, anchor: null };
    }

    return null;
  }

  /** Remove the injected clone if it exists. */
  function removeClone() {
    const existing = document.getElementById(CLONE_ID);
    if (existing) existing.remove();
  }

  /** Restore any sidebar button we hid. */
  function restoreSidebar() {
    document
      .querySelectorAll(`[${HIDDEN_ATTR}]`)
      .forEach((el) => {
        el.removeAttribute(HIDDEN_ATTR);
        el.style.display = "";
      });
  }

  /** Full teardown – called on URL change or when we want to retry. */
  function teardown() {
    removeClone();
    restoreSidebar();
    const ns = window[NS];
    if (ns && ns.syncObserver) {
      ns.syncObserver.disconnect();
      ns.syncObserver = null;
    }
  }

  /**
   * Build a toolbar-friendly clone of the sidebar button and insert it
   * on the right side of the chat input toolbar.
   */
  function inject() {
    if (document.getElementById(CLONE_ID)) return; // already injected

    const sidebarBtn = findSidebarButton();
    if (!sidebarBtn) return; // not found yet – MutationObserver will retry

    const trailingInfo = findToolbarTrailingArea();
    if (!trailingInfo) return; // toolbar not ready yet

    const { container, anchor } = trailingInfo;

    /* --- Clone the button --- */
    const clone = sidebarBtn.cloneNode(true);
    clone.id = CLONE_ID;
    clone.removeAttribute("data-drawer-trigger"); // avoid sidebar side-effects
    clone.removeAttribute("jsaction");

    /* Toolbar-style sizing */
    clone.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border-radius: 50%;
      padding: 8px;
      background: transparent;
      border: none;
      color: inherit;
      margin-inline-start: 4px;
      vertical-align: middle;
      transition: background 0.2s;
    `;

    /* Clicking the clone toggles the real sidebar button */
    clone.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sidebarBtn.click();
      // Sync visual state immediately
      syncState();
    });

    /* Insert before the anchor (mic button) or at the end of the container */
    if (anchor && anchor.parentElement === container) {
      container.insertBefore(clone, anchor);
    } else {
      container.appendChild(clone);
    }

    /* Hide the original sidebar button */
    sidebarBtn.setAttribute(HIDDEN_ATTR, "true");
    sidebarBtn.style.display = "none";

    /* Keep the clone's active/aria state in sync */
    function syncState() {
      const isActive =
        sidebarBtn.getAttribute("aria-pressed") === "true" ||
        sidebarBtn.classList.contains("active") ||
        sidebarBtn.getAttribute("aria-checked") === "true";

      if (isActive) {
        clone.style.background = "rgba(255,255,255,0.15)";
        clone.setAttribute("aria-pressed", "true");
      } else {
        clone.style.background = "transparent";
        clone.setAttribute("aria-pressed", "false");
      }

      // Mirror aria-label
      const label = sidebarBtn.getAttribute("aria-label");
      if (label) clone.setAttribute("aria-label", label);
    }

    syncState();

    if (!window[NS]) window[NS] = {};
    window[NS].syncObserver = new MutationObserver(syncState);
    window[NS].syncObserver.observe(sidebarBtn, {
      attributes: true,
      attributeFilter: ["aria-pressed", "aria-checked", "class", "aria-label"],
    });
  }

  /* ------------------------------------------------------------------ */
  /* DOM watcher – retries inject() until all elements are present       */
  /* ------------------------------------------------------------------ */

  let domObserver = null;

  function startDomObserver() {
    if (domObserver) domObserver.disconnect();

    domObserver = new MutationObserver(() => {
      inject();
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Try immediately as well
    inject();
  }

  /* ------------------------------------------------------------------ */
  /* SPA navigation detection                                            */
  /* ------------------------------------------------------------------ */

  let lastUrl = location.href;

  function onNavigate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    teardown();
    // Give the new view a moment to render before re-injecting
    setTimeout(startDomObserver, NAVIGATION_DELAY_MS);
  }

  // Intercept pushState / replaceState
  ["pushState", "replaceState"].forEach((method) => {
    const orig = history[method];
    history[method] = function (...args) {
      orig.apply(this, args);
      onNavigate();
    };
  });

  window.addEventListener("popstate", onNavigate);

  // Periodic check as a last-resort fallback (covers hash-only changes)
  setInterval(onNavigate, POLL_INTERVAL_MS);

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                           */
  /* ------------------------------------------------------------------ */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDomObserver);
  } else {
    startDomObserver();
  }
})();
