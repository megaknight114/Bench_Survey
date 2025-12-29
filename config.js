// Configuration for the survey
// Replace YOUR_APPS_SCRIPT_URL with the URL from your deployed Apps Script Web App

// Cache-bust version string.
// Bump this whenever you update docs/texts.json (or want to invalidate old browser/localStorage caches).
const TEXTS_VERSION = '2025-12-29-02-07';

const CONFIG = {
  // Get this URL after deploying your Apps Script as a Web App
  // Format: https://script.google.com/macros/s/AKfycbxxxxx/exec
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwBNQ7IFOg0-nojBCQdVKsfCrcc-3kO0qDLY5mgV_Qs3WoggRJpWZPGjPKmMmCKNaja/exec',
  
  // Optional: If you host texts.json elsewhere, change this URL
  // Add ?v=... to avoid stale GitHub Pages / browser caches.
  TEXTS_JSON_URL: './texts.json?v=' + encodeURIComponent(TEXTS_VERSION),
  TEXTS_VERSION
};
