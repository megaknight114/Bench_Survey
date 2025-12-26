/**
 * Google Apps Script for Survey Backend
 * 
 * SETUP INSTRUCTIONS:
 * 1. Create a Google Sheet with two tabs: "responses" and "assignments"
 * 2. In "responses" tab, add header row:
 *    timestamp, allocation_id, participant_code, text_id, topic, gender, age, education, social_media_time, topic_familiarity, understanding, credibility, willingness_to_share, intent_strength, purpose
 * 3. In "assignments" tab, add header row:
 *    assigned_at, allocation_id, participant_code, text_id, topic, status, submitted_at
 * 4. Replace YOUR_SHEET_ID below with your Sheet ID (from the URL)
 * 5. Deploy as Web App: Execute as "Me", Access "Anyone"
 */

// REPLACE THIS WITH YOUR GOOGLE SHEET ID
const SHEET_ID = '1UTBDwciN0EwYxnYqb8nHEv1YmfgxnriNCDCW2rkKlVA';

// Default *assignment index* URL (can be overridden by Script Properties key: TEXTS_JSON_URL)
// IMPORTANT:
// - This URL should return a JSON array like: [{ "text_id": "...", "topic": "..." }, ...]
// - Do NOT point this to a large full texts.json; Apps Script CacheService has per-item size limits (~100KB).
// Example (GitHub Pages): https://<username>.github.io/<repo>/texts_index.json
// NOTE: GitHub Pages can serve files either at:
// - https://<username>.github.io/<repo>/texts.json            (Pages source = /docs)
// - https://<username>.github.io/<repo>/docs/texts.json       (Pages source = /(root) and files kept under /docs)
// If you hit "No texts available", set Script Property TEXTS_JSON_URL to the *working* URL in a browser.
const DEFAULT_TEXTS_JSON_URL = 'https://megaknight114.github.io/Bench_Survey/texts_index.json';

// Cache texts.json to reduce UrlFetch calls (seconds)
const TEXTS_CACHE_SECONDS = 60;
// Global sequential pointer for cycling assignment (mod texts.length).
const NEXT_TEXT_INDEX_PROPERTY = 'NEXT_TEXT_INDEX';

const ASSIGNMENTS_REQUIRED_HEADERS = [
  'assigned_at',
  'allocation_id',
  'participant_code',
  'text_id',
  'topic',
  'status',
  'submitted_at'
];

// Keep the response schema minimal & stable (avoid duplicated/unused columns).
// NOTE: If your existing Google Sheet already has extra columns, this script will not delete them;
// it will simply stop writing to those redundant columns going forward.
const RESPONSES_REQUIRED_HEADERS = [
  'timestamp',
  'allocation_id',
  'participant_code',
  'text_id',
  'topic',
  'gender',
  'age',
  'education',
  'social_media_time',
  'topic_familiarity',
  'understanding',
  'credibility',
  'willingness_to_share',
  'intent_strength',
  'purpose'
];

/**
 * Handle GET requests for text assignment
 * Query params (optional): participant_code
 *
 * Assignment policy:
 * - Natural sequential assignment over the texts array.
 * - Cycles when reaching the end (no exhaustion).
 * - Allocation happens immediately on doGet (reservation), under a lock, by writing to the "assignments" sheet.
 * - doPost will mark the allocation as submitted.
 *
 * Returns JSON: {allocation_id, participant_code, text_id, topic} or {error: "message"}
 */
function doGet(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!SHEET_ID || SHEET_ID === 'YOUR_SHEET_ID') {
      return jsonOutput({error: 'Server misconfigured: SHEET_ID is not set'});
    }

    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const assignmentsSheet = sheet.getSheetByName('assignments');
    if (!assignmentsSheet) {
      return jsonOutput({error: 'Assignments sheet not found'});
    }

    lock.waitLock(10000); // Wait up to 10 seconds

    const participantCode = (e && e.parameter && e.parameter.participant_code)
      ? String(e.parameter.participant_code || '').trim()
      : '';
    if (!participantCode || participantCode.length < 4) {
      return jsonOutput({ error: 'Missing participant_code (anonymous code). Please enter a code (>= 4 chars).' });
    }

    // 1) Load texts index
    const textsResult = getTextsArrayWithDiagnostics_();
    const texts = textsResult.texts;
    if (!texts || texts.length === 0) {
      return jsonOutput({
        error:
          'No texts available. texts.json fetch failed. ' +
          (textsResult && textsResult.debug ? textsResult.debug : 'No debug info')
      });
    }

    // 2) Ensure assignments header
    const assignmentsHeader = ensureHeaders_(assignmentsSheet, ASSIGNMENTS_REQUIRED_HEADERS);
    const props = PropertiesService.getScriptProperties();
    const rawIdx = props.getProperty(NEXT_TEXT_INDEX_PROPERTY);
    let idx = rawIdx ? parseInt(rawIdx, 10) : 0;
    if (isNaN(idx) || idx < 0) idx = 0;
    const chosen = texts[idx % texts.length];
    // Advance pointer (best-effort).
    try {
      props.setProperty(NEXT_TEXT_INDEX_PROPERTY, String((idx + 1) % texts.length));
    } catch (e2) {}

    // 4) Record allocation immediately (reservation)
    const allocationId = Utilities.getUuid();
    const assignmentRowObj = {
      assigned_at: new Date(),
      allocation_id: allocationId,
      participant_code: participantCode,
      text_id: chosen.text_id,
      topic: chosen.topic,
      status: 'assigned',
      submitted_at: ''
    };
    appendRowByHeader_(assignmentsSheet, assignmentsHeader, assignmentRowObj);

    return jsonOutput({
      allocation_id: allocationId,
      participant_code: participantCode,
      text_id: chosen.text_id,
      topic: chosen.topic
    });
  } catch (error) {
    // If lock acquisition times out, Apps Script throws; surface a clear error.
    const msg = String(error && error.toString ? error.toString() : error);
    if (msg && msg.indexOf('Timed out') !== -1) {
      return jsonOutput({error: 'Assignment lock timeout'});
    }
    return jsonOutput({error: msg});
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Handle POST requests for survey responses
 * Body: JSON with all response fields
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!SHEET_ID || SHEET_ID === 'YOUR_SHEET_ID') {
      return jsonOutput({error: 'Server misconfigured: SHEET_ID is not set'});
    }
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const responsesSheet = sheet.getSheetByName('responses');
    const assignmentsSheet = sheet.getSheetByName('assignments');

    if (!responsesSheet) {
      return jsonOutput({error: 'Responses sheet not found'});
    }
    if (!assignmentsSheet) {
      return jsonOutput({error: 'Assignments sheet not found'});
    }

    // Parse request body
    let data;
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      return jsonOutput({error: 'No data provided'});
    }

    const participantCode = String(data.participant_code || '').trim();
    if (!participantCode || participantCode.length < 4) {
      return jsonOutput({ error: 'Missing participant_code (anonymous code). Please re-enter and resubmit.' });
    }

    const responsesHeader = ensureHeaders_(responsesSheet, RESPONSES_REQUIRED_HEADERS);
    const assignmentHeader = ensureHeaders_(assignmentsSheet, ASSIGNMENTS_REQUIRED_HEADERS);

    // 1) Append response row first (submission is considered "successful" if this works).
    appendRowByHeader_(responsesSheet, responsesHeader, {
      timestamp: new Date(),
      allocation_id: data.allocation_id || '',
      participant_code: participantCode,
      text_id: data.text_id || '',
      topic: data.topic || '',
      gender: data.gender || '',
      age: data.age || '',
      education: data.education || '',
      social_media_time: data.social_media_time || '',
      topic_familiarity: data.topic_familiarity || '',
      understanding: data.understanding || '',
      credibility: data.credibility || '',
      willingness_to_share: data.willingness_to_share || '',
      intent_strength: data.intent_strength || '',
      purpose: data.purpose || ''
    });

    // 2) Mark allocation as submitted (best-effort).
    const allocationId = String(data.allocation_id || '').trim();
    if (allocationId) {
      lock.waitLock(10000);
      markAllocationSubmitted_(assignmentsSheet, assignmentHeader, allocationId, {
        participant_code: participantCode,
        submitted_at: new Date()
      });
    }

    return jsonOutput({status: 'ok'});
  } catch (error) {
    const msg = String(error && error.toString ? error.toString() : error);
    if (msg && msg.indexOf('Timed out') !== -1) {
      return jsonOutput({error: 'Submission lock timeout'});
    }
    return jsonOutput({error: msg});
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Helper: Create JSON output
 */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Helper: Normalize header keys
 */
function normalizeHeaderKey_(h) {
  return String(h || '').trim().toLowerCase();
}

/**
 * Ensure the first row contains at least the required headers.
 * - If the sheet is empty or row-1 is empty, initializes row-1 to required headers.
 * - If some required headers are missing, appends them to the right.
 * Returns: { headers: string[], map: { [normalizedHeaderKey]: 1-based-col-index } }
 */
function ensureHeaders_(sheet, requiredHeaders) {
  const lastCol = Math.max(sheet.getLastColumn(), 0);
  if (lastCol === 0) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return buildHeaderInfo_(requiredHeaders);
  }

  const row1 = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const existing = row1.map(v => String(v || '').trim());

  // If row1 is effectively empty, initialize
  const hasAny = existing.some(v => v);
  if (!hasAny) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return buildHeaderInfo_(requiredHeaders);
  }

  const existingKeys = {};
  for (let i = 0; i < existing.length; i++) {
    const k = normalizeHeaderKey_(existing[i]);
    if (k) existingKeys[k] = true;
  }

  const toAdd = [];
  for (let j = 0; j < requiredHeaders.length; j++) {
    const req = requiredHeaders[j];
    const k = normalizeHeaderKey_(req);
    if (!existingKeys[k]) toAdd.push(req);
  }

  const finalHeaders = existing.slice();
  if (toAdd.length > 0) {
    // Append missing headers to row1
    for (let i2 = 0; i2 < toAdd.length; i2++) finalHeaders.push(toAdd[i2]);
    sheet.getRange(1, 1, 1, finalHeaders.length).setValues([finalHeaders]);
  }

  return buildHeaderInfo_(finalHeaders);
}

function buildHeaderInfo_(headers) {
  const map = {};
  for (let i = 0; i < headers.length; i++) {
    const k = normalizeHeaderKey_(headers[i]);
    if (k && !map[k]) map[k] = i + 1; // 1-based
  }
  return { headers: headers, map: map };
}

function appendRowByHeader_(sheet, headerInfo, obj) {
  const headers = headerInfo.headers;
  const map = headerInfo.map;
  const row = new Array(headers.length).fill('');
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const col = map[normalizeHeaderKey_(key)];
    if (col) row[col - 1] = obj[key];
  }
  sheet.appendRow(row);
}

function getAllocatedTextIdSet_(assignmentsSheet, headerInfo) {
  const map = headerInfo.map;
  const textIdCol = map[normalizeHeaderKey_('text_id')];
  const statusCol = map[normalizeHeaderKey_('status')];
  const used = {};
  const lastRow = assignmentsSheet.getLastRow();
  if (!textIdCol || lastRow < 2) return used;

  const lastCol = Math.max(assignmentsSheet.getLastColumn(), 0);
  const values = assignmentsSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const tid = row[textIdCol - 1];
    if (!tid) continue;
    const status = statusCol ? String(row[statusCol - 1] || '').trim().toLowerCase() : '';
    if (status === 'released') continue;
    used[String(tid)] = true;
  }
  return used;
}

function markAllocationSubmitted_(assignmentsSheet, headerInfo, allocationId, updates) {
  const map = headerInfo.map;
  const allocCol = map[normalizeHeaderKey_('allocation_id')];
  if (!allocCol) return;

  const finder = assignmentsSheet
    .createTextFinder(allocationId)
    .matchEntireCell(true);
  const cell = finder.findNext();
  if (!cell) return;

  const row = cell.getRow();
  const statusCol = map[normalizeHeaderKey_('status')];
  const submittedAtCol = map[normalizeHeaderKey_('submitted_at')];
  const participantCodeCol = map[normalizeHeaderKey_('participant_code')];

  if (statusCol) assignmentsSheet.getRange(row, statusCol).setValue('submitted');
  if (submittedAtCol && updates && updates.submitted_at) assignmentsSheet.getRange(row, submittedAtCol).setValue(updates.submitted_at);

  // Fill participant_code if empty and provided
  if (participantCodeCol && updates && updates.participant_code) {
    const cur = String(assignmentsSheet.getRange(row, participantCodeCol).getValue() || '').trim();
    if (!cur) assignmentsSheet.getRange(row, participantCodeCol).setValue(updates.participant_code);
  }
}

/**
 * Get texts array from PropertiesService or fetch from URL
 * Option 1: Store texts in PropertiesService (for small datasets)
 * Option 2: Fetch from public URL (recommended for larger datasets)
 * 
 * For now, this returns an empty array - you need to populate it.
 * See README.md for instructions on how to load texts.
 */
function getTextsArray() {
  // Backwards compatible wrapper (older code expects an array)
  return getTextsArrayWithDiagnostics_().texts;
}

/**
 * Fetch texts.json with robust URL normalization + diagnostics.
 * Returns: { texts: Array, debug: string }
 */
function getTextsArrayWithDiagnostics_() {
  const props = PropertiesService.getScriptProperties();
  const rawUrl = props.getProperty('TEXTS_JSON_URL') || DEFAULT_TEXTS_JSON_URL;
  const version = props.getProperty('TEXTS_JSON_VERSION') || '';

  const candidates = buildTextsUrlCandidates_(rawUrl);
  const attempted = [];

  // Cache to reduce repeated fetches (keyed by first candidate + version).
  // NOTE: CacheService has a per-key value limit (~100KB). We only cache when the payload is small.
  const cache = CacheService.getScriptCache();
  const cacheKey = 'texts_json::' + (version || 'default') + '::' + (candidates[0] || 'default');
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { texts: parsed, debug: 'cache-hit' };
      }
    } catch (e) {
      // fall through to refetch
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    const base = candidates[i];
    const fetchUrl =
      base + (version ? ((base.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(version)) : '');

    const resp = fetchJson_(fetchUrl);
    attempted.push(resp.summary);
    if (resp.ok && Array.isArray(resp.json) && resp.json.length > 0) {
      // Cache only if small enough; otherwise skip caching to avoid "argument/value too large" errors.
      try {
        const asString = JSON.stringify(resp.json);
        if (asString.length <= 90 * 1024) {
          cache.put(cacheKey, asString, TEXTS_CACHE_SECONDS);
        }
      } catch (e) {
        // Ignore cache errors; still return the fetched payload.
      }
      return { texts: resp.json, debug: 'ok url=' + fetchUrl };
    }
  }

  const debug = 'attempted: ' + attempted.join(' | ');
  // Persist last failure summary for quick debugging in Apps Script.
  try { props.setProperty('LAST_TEXTS_FETCH_ERROR', debug); } catch (e) {}
  Logger.log('No texts available. ' + debug);
  return { texts: [], debug };
}

function buildTextsUrlCandidates_(rawUrl) {
  const u = String(rawUrl || '').trim();
  if (!u) return [DEFAULT_TEXTS_JSON_URL];

  // If user provided a base like ".../<repo>/" or ".../<repo>", append texts.json
  let url = u;
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (!/\.json(\?|#|$)/.test(url)) {
    url = url + '/texts.json';
  }

  // Build common GitHub Pages variants by toggling "/docs" right before "/texts.json"
  const candidates = [url];
  const withDocs = url.replace(/\/texts\.json(\?|#|$)/, '/docs/texts.json$1');
  const withoutDocs = url.replace(/\/docs\/texts\.json(\?|#|$)/, '/texts.json$1');
  if (withDocs !== url) candidates.push(withDocs);
  if (withoutDocs !== url && withoutDocs !== withDocs) candidates.push(withoutDocs);

  // Deduplicate while preserving order
  const seen = {};
  const out = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!seen[c]) { seen[c] = true; out.push(c); }
  }
  return out;
}

function fetchJson_(url) {
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText() || '';
    if (code !== 200) {
      return {
        ok: false,
        json: null,
        summary: 'HTTP ' + code + ' url=' + url + ' body[0:120]=' + body.slice(0, 120)
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      return {
        ok: false,
        json: null,
        summary: 'Invalid JSON url=' + url + ' body[0:120]=' + body.slice(0, 120)
      };
    }
    return { ok: true, json: parsed, summary: 'OK url=' + url };
  } catch (e) {
    return { ok: false, json: null, summary: 'EXC url=' + url + ' err=' + String(e) };
  }
}

