# Gemini Temporary Chat Toolbar

A Chromium browser extension that moves the **Temporary Chat** toggle from the
sidebar navigation rail into the **chat input toolbar** (right side, next to
the output-speed selector and the dictation button) whenever a new Google
Gemini chat is open.

## Why?

Google Gemini places the *Temporary chat* toggle in the left sidebar, which
requires an extra click to reach the nav rail. This extension surfaces it
right inside the chat input area so you can toggle it without leaving the
conversation flow.

## What it does

| Before | After |
|--------|-------|
| Temporary-chat icon lives in the left sidebar nav rail | Icon is hidden from the sidebar and appears on the **right side of the toolbar** (before the dictation button) |

The toolbar layout (bottom of the chat input) becomes:

```
[ + ] [ Tools ]   ·····text input·····   [ Temp-chat ] [ Speed ] [ 🎤 ]
```

## Installation

1. Clone or download this repository.
2. Open Chrome / Edge / Brave and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this folder.
5. Open [gemini.google.com](https://gemini.google.com) – the icon will be
   automatically moved on every page load.

## How it works

`content.js` is injected into every `gemini.google.com` page and:

1. Searches the DOM for a `<button>` whose `aria-label` contains
   *"temporary chat"* (the sidebar button).
2. Clones that button and inserts the clone into the toolbar's trailing area
   (before the dictation / microphone button).
3. Hides the original sidebar button.
4. Keeps the clone's active state in sync with the original via a
   `MutationObserver`.
5. Tears down and re-injects automatically on SPA navigation (URL changes).

## Files

```
manifest.json   – Extension manifest (Manifest V3)
content.js      – Content script (the core logic)
icons/          – Extension icons (16 × 16, 48 × 48, 128 × 128)
```

## Permissions

The extension requests **no special permissions** and only runs on
`https://gemini.google.com/*`.
