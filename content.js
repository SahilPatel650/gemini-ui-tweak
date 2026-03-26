/**
 * Gemini UI Tweak — Content Script
 *
 * When Google Gemini shows a new (empty) chat view, this script:
 *   1. Finds the "Temporary chat" button in the sidebar.
 *   2. Hides the sidebar copy.
 *   3. Injects a functional clone above the main chat input.
 *
 * On navigating away from a new chat, the clone is removed and the
 * sidebar button is restored.
 */
(function () {
  'use strict';

  const WRAPPER_ID = 'gemini-ui-tweak-temp-btn-wrapper';
  const HIDDEN_ATTR = 'data-gemini-ui-tweak-hidden';

  // ─── Selector helpers ────────────────────────────────────────────────────────

  /**
   * Walks ancestors of `el` and returns the first element matching `selector`,
   * or `null` if none is found before `document.body`.
   */
  function closestOrSelf(el, selector) {
    if (!el) return null;
    return el.matches(selector) ? el : el.closest(selector);
  }

  /**
   * Searches the document for the "Temporary chat" sidebar button using
   * several progressive strategies so that minor Gemini DOM changes don't
   * break the extension.
   *
   * @returns {Element|null}
   */
  function findSidebarTempChatButton() {
    // ── Strategy 1: explicit aria-label / title attributes ──────────────────
    const byAttr = document.querySelector(
      '[aria-label*="Temporary" i][aria-label*="chat" i],' +
      '[title*="Temporary" i][title*="chat" i],' +
      '[data-test-id="temporary-chat"],' +
      '[data-testid="temporary-chat"]'
    );
    if (byAttr) return byAttr;

    // ── Strategy 2: mat-icon whose name suggests incognito / private ─────────
    const iconNames = ['edit_off', 'visibility_off', 'no_accounts', 'hide_source'];
    for (const name of iconNames) {
      const icon = document.querySelector(`mat-icon[fonticon="${name}"], mat-icon[data-mat-icon-name="${name}"]`);
      if (icon) {
        const btn = closestOrSelf(icon, 'button, a, [role="button"], [role="listitem"], li');
        if (btn) return btn;
      }
    }

    // ── Strategy 3: text-node scan for "Temporary chat" inside nav/aside ────
    const sidebarRoots = document.querySelectorAll(
      'nav, aside, [class*="sidebar"], [class*="side-nav"], [class*="side_nav"], [data-drawer]'
    );
    for (const root of sidebarRoots) {
      const found = findByText(root, 'Temporary chat');
      if (found) return found;
    }

    // ── Strategy 4: full-document text scan (last resort) ───────────────────
    return findByText(document.body, 'Temporary chat');
  }

  /**
   * Scans `root` for an element whose trimmed text exactly matches `text`
   * and returns the nearest interactive ancestor.
   *
   * @param {Element} root
   * @param {string}  text
   * @returns {Element|null}
   */
  function findByText(root, text) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.trim() === text) {
        const btn = closestOrSelf(
          node.parentElement,
          'button, a, [role="button"], [role="listitem"], li'
        );
        if (btn && !btn.id.startsWith('gemini-ui-tweak')) return btn;
      }
    }
    return null;
  }

  // ─── New-chat detection ───────────────────────────────────────────────────

  /**
   * Returns `true` when Gemini is showing a new / empty chat view:
   * either the path is the root/app path, or no conversation turns exist yet.
   */
  function isNewChatView() {
    const { pathname } = window.location;
    if (pathname === '/' || pathname === '/app' || pathname === '') return true;

    // Gemini wraps each exchange in a conversation-turn element.
    const hasTurns = document.querySelector(
      'model-response, user-query, [data-message-author-role], ' +
      '.conversation-container [class*="turn"], [class*="message-bubble"]'
    );
    return !hasTurns;
  }

  // ─── Insertion-point detection ────────────────────────────────────────────

  /**
   * Finds the element in the main chat area above which we should insert the
   * Temporary Chat button clone.  Prefers the text-input container so the
   * button sits just above the input box, matching a natural CTA position.
   */
  function findInsertionPoint() {
    // Prefer the rich text area / input container
    const inputSelectors = [
      'rich-textarea',
      '.ql-editor',
      'textarea[placeholder]',
      '[contenteditable="true"][role="textbox"]',
      '[data-placeholder]',
    ];
    for (const sel of inputSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        // Walk up to the form or the first "input wrapper" ancestor
        return el.closest('form') || el.closest('[class*="input"]') || el.parentElement;
      }
    }

    // Fall back to the greeting / zero-state container
    const staticSelectors = [
      '[class*="greeting"]',
      '[class*="zero-state"]',
      '[class*="new-chat"]',
      '[class*="empty-state"]',
      'main h1',
    ];
    for (const sel of staticSelectors) {
      const el = document.querySelector(sel);
      if (el) return el.closest('section') || el.parentElement;
    }

    return null;
  }

  // ─── Injection / cleanup ──────────────────────────────────────────────────

  /**
   * Clones the sidebar Temporary Chat button, hides the sidebar original,
   * and inserts the clone into the main chat interface.
   */
  function injectTempChatButton() {
    if (document.getElementById(WRAPPER_ID)) return; // already injected

    const sidebarBtn = findSidebarTempChatButton();
    if (!sidebarBtn) return;

    const insertionPoint = findInsertionPoint();
    if (!insertionPoint) return;

    // Build the injected wrapper
    const wrapper = document.createElement('div');
    wrapper.id = WRAPPER_ID;
    wrapper.className = 'gemini-ui-tweak-temp-chat-btn';
    wrapper.setAttribute('role', 'none');

    // Clone the sidebar button (deep, so icon + label are included)
    const clone = sidebarBtn.cloneNode(true);
    clone.removeAttribute('id');

    // Clicking the clone triggers the real sidebar button so all of Gemini's
    // own event handlers / state management run normally.
    clone.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sidebarBtn.click();
    });

    wrapper.appendChild(clone);

    // Hide the sidebar copy
    sidebarBtn.setAttribute(HIDDEN_ATTR, 'true');
    sidebarBtn.classList.add('gemini-ui-tweak-sidebar-hidden');

    // Insert above the insertion-point element
    const parent = insertionPoint.parentElement;
    if (parent) {
      parent.insertBefore(wrapper, insertionPoint);
    } else {
      (document.querySelector('main') || document.body).appendChild(wrapper);
    }
  }

  /** Removes the injected clone and restores the sidebar button. */
  function cleanup() {
    const wrapper = document.getElementById(WRAPPER_ID);
    if (wrapper) wrapper.remove();

    document.querySelectorAll(`[${HIDDEN_ATTR}="true"]`).forEach((el) => {
      el.removeAttribute(HIDDEN_ATTR);
      el.classList.remove('gemini-ui-tweak-sidebar-hidden');
    });
  }

  // ─── Orchestration ────────────────────────────────────────────────────────

  function run() {
    if (isNewChatView()) {
      injectTempChatButton();
    } else {
      cleanup();
    }
  }

  // Debounced MutationObserver — handles Gemini's React-driven DOM updates
  let debounceTimer = null;
  const domObserver = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, 350);
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Intercept History API calls so we react to SPA navigations
  const _pushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    _pushState(...args);
    setTimeout(run, 500);
  };

  const _replaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    _replaceState(...args);
    setTimeout(run, 500);
  };

  window.addEventListener('popstate', () => setTimeout(run, 500));

  // Kick off on script load
  run();
})();
