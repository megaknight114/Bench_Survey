// Survey application logic

let participantCode = '';
let assignedText = null;
let textsMap = {}; // text_id -> {text, topic}
let consentGiven = false;
let startFromTextPage = false;

const SESSION_ASSIGNED_TEXT_KEY = 'assigned_text';
const SESSION_PARTICIPANT_CODE_KEY = 'participant_code';
const SESSION_COMPLETED_COUNT_KEY = 'completed_count';

const TARGET_TEXT_COUNT = 5;
let completedCount = 0;

function getCurrentTextNumber() {
  return Math.min(completedCount + 1, TARGET_TEXT_COUNT);
}

function updateSubmitButtonLabel() {
  const submitBtn = document.getElementById('submit-btn');
  if (!submitBtn) return;
  // Only update when enabled; loading states set their own label.
  if (submitBtn.disabled) return;
  const n = getCurrentTextNumber();
  submitBtn.textContent = `Submit (Text ${n} of ${TARGET_TEXT_COUNT})`;
}

function updateProgressIndicator() {
  const el = document.getElementById('progress-indicator');
  if (!el) return;
  el.textContent = `Text ${getCurrentTextNumber()} of ${TARGET_TEXT_COUNT}`;
  updateSubmitButtonLabel();
}

function isSurveyVisible() {
  const el = document.getElementById('survey-section');
  if (!el) return false;
  return el.style.display !== 'none';
}

function setSurveySubmitState(isLoading, loadingText) {
  const submitBtn = document.getElementById('submit-btn');
  if (!submitBtn) return;
  if (isLoading) {
    submitBtn.disabled = true;
    submitBtn.textContent = loadingText || 'Loading...';
  } else {
    submitBtn.disabled = false;
    updateSubmitButtonLabel();
  }
}

function setSkipButtonState(isLoading, loadingText) {
  const btn = document.getElementById('skip-text-btn');
  if (!btn) return;
  if (!btn.getAttribute('data-original-text')) {
    btn.setAttribute('data-original-text', btn.textContent || '');
  }
  btn.disabled = !!isLoading;
  if (isLoading) {
    btn.textContent = loadingText || 'Loading...';
  } else {
    btn.textContent = btn.getAttribute('data-original-text') || 'Skip this text (display issue)';
  }
}

function resetPage2Answers() {
  const page2 = document.getElementById('survey-page-2');
  if (!page2) return;

  // Clear radios on page 2
  const radios = page2.querySelectorAll('input[type="radio"]');
  radios.forEach(r => { r.checked = false; });

  // Clear and hide purpose dropdown
  const purposeSelect = document.getElementById('purpose-text');
  if (purposeSelect) purposeSelect.value = '';
  updatePurposeFreeTextVisibility();
}

function renderAssignedText() {
  if (!assignedText || !assignedText.text_id) return;
  const mapEntry = textsMap[assignedText.text_id];
  if (!mapEntry || !mapEntry.text) return;

  const rawText = mapEntry.text;
  const parsed = parseTextWithTitle(rawText);

  const titleEl = document.getElementById('text-title');
  const contentEl = document.getElementById('text-content');

  if (titleEl && contentEl) {
    if (parsed.title) {
      titleEl.textContent = parsed.title;
      titleEl.classList.add('has-title');
      contentEl.classList.add('has-title');
    } else {
      titleEl.textContent = '';
      titleEl.classList.remove('has-title');
      contentEl.classList.remove('has-title');
    }
    contentEl.textContent = parsed.body;
  }

  updateProgressIndicator();
  setSurveySubmitState(false);
  setSkipButtonState(false);
}

function setConsentSubmitState(isLoading, loadingText) {
  const btn = document.querySelector('#consent-form button[type="submit"]');
  if (!btn) return;
  if (!btn.getAttribute('data-original-text')) {
    btn.setAttribute('data-original-text', btn.textContent || '');
  }
  btn.disabled = !!isLoading;
  if (isLoading) {
    btn.textContent = loadingText || 'Loading...';
  } else {
    btn.textContent = btn.getAttribute('data-original-text') || 'Continue';
  }
}

// Prevent the browser from restoring scroll position (can look like "auto-jumping" to page 2).
if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
  try { history.scrollRestoration = 'manual'; } catch (e) {}
}

function showSurveyPage(page) {
  const page1 = document.getElementById('survey-page-1');
  const page2 = document.getElementById('survey-page-2');
  if (!page1 || !page2) return;
  if (page === 1) {
    page1.style.display = 'block';
    page2.style.display = 'none';
  } else {
    page1.style.display = 'none';
    page2.style.display = 'block';
    // Update purpose dropdown visibility when showing page 2
    updatePurposeFreeTextVisibility();
    updateProgressIndicator();
  }

  // Force scroll-to-top after layout/scroll restoration; avoids the "flash then jump" effect.
  const scrollTop = () => {
    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); }
    catch (e) { window.scrollTo(0, 0); }
  };
  scrollTop();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scrollTop);
  setTimeout(scrollTop, 0);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
  // Safety: ensure familiarity block is inside page 2 and placed before the buttons.
  normalizeSurveyDom();

  // Restore completedCount (best-effort) so refresh mid-session doesn't break progress display.
  try {
    const savedCount = sessionStorage.getItem(SESSION_COMPLETED_COUNT_KEY);
    if (savedCount != null) {
      const n = parseInt(savedCount, 10);
      if (!isNaN(n) && n >= 0) completedCount = n;
    }
  } catch (e) {}

  // Restore participant code for convenience within the same tab/session.
  try {
    const savedCode = sessionStorage.getItem(SESSION_PARTICIPANT_CODE_KEY);
    if (savedCode) {
      participantCode = savedCode;
      const input = document.getElementById('participant-code');
      if (input) input.value = savedCode;
    }
  } catch (e) {}

  // Load texts.json
  loadTexts().then(() => {
    // Optionally restore a pending in-tab assignment (useful if user refreshes mid-survey).
    try {
      const savedAssignment = sessionStorage.getItem(SESSION_ASSIGNED_TEXT_KEY);
      if (savedAssignment) assignedText = JSON.parse(savedAssignment);
    } catch (e) {}
  }).catch(err => {
    console.error('Error loading texts:', err);
    showError('Failed to load survey texts. Please refresh the page.');
  });
});

function normalizeSurveyDom() {
  const page2 = document.getElementById('survey-page-2');
  const backBtn = document.getElementById('back-btn');
  const submitBtn = document.getElementById('submit-btn');
  const familiarityBlock = document.getElementById('topic-familiarity-block');
  if (!page2 || !familiarityBlock) return;

  // Always move the block into page2 if it escaped due to HTML auto-correction or cached old markup.
  if (!page2.contains(familiarityBlock)) {
    page2.appendChild(familiarityBlock);
  }

  // Ensure the block is right before the buttons.
  const anchor = backBtn || submitBtn;
  if (anchor && anchor.parentNode === page2) {
    page2.insertBefore(familiarityBlock, anchor);
  }

  // Ensure page2 starts hidden (defensive).
  if (!page2.style.display) {
    page2.style.display = 'none';
  }
}

function updatePurposeFreeTextVisibility() {
  const intentStrengthEl = document.querySelector('input[name="intent-strength"]:checked');
  const block = document.getElementById('purpose-free-text-block');
  const textarea = document.getElementById('purpose-text');
  if (!block || !textarea) return;

  const intentStrength = intentStrengthEl ? parseInt(intentStrengthEl.value, 10) : 0;
  // Only show the follow-up (4.2) when intent is at least 2.
  const shouldShow = intentStrength >= 2;

  block.style.display = shouldShow ? 'block' : 'none';
  textarea.required = shouldShow;

  if (!shouldShow) {
    textarea.value = '';
  } else {
    // Nudge the user to answer immediately.
    try { textarea.focus(); } catch (e) {}
  }
}

/**
 * Load texts.json from the configured URL
 */
async function loadTexts() {
  const response = await fetch(CONFIG.TEXTS_JSON_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load texts.json');
  }
  const texts = await response.json();
  
  // Build map for quick lookup
  texts.forEach(item => {
    textsMap[item.text_id] = {
      text: item.text,
      topic: item.topic
    };
  });
}

/**
 * Request text assignment from Apps Script
 */
async function requestAssignment() {
  // Provide immediate UI feedback (especially on slower networks / in-app browsers).
  setConsentSubmitState(true, 'Assigning a text...');
  try {
    const params = new URLSearchParams();
    if (participantCode) params.set('participant_code', participantCode);
    const url = `${CONFIG.APPS_SCRIPT_URL}?${params.toString()}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error('Assignment request failed');
    }
    
    const data = await response.json();
    
    if (data.error) {
      showError('Assignment error: ' + data.error);
      return;
    }
    
    assignedText = data;
    try { sessionStorage.setItem(SESSION_ASSIGNED_TEXT_KEY, JSON.stringify(assignedText)); } catch (e) {}
    // Only show survey after consent; avoids race where user clicks consent before assignment returns.
    // If the survey is already visible (5-text loop), just render the next text in place.
    if (consentGiven) {
      if (isSurveyVisible()) {
        renderAssignedText();
      } else {
        showSurvey();
      }
    }
    
  } catch (err) {
    console.error('Assignment error:', err);
    showError('Failed to assign text. Please refresh the page.');
  } finally {
    // If we transitioned to the survey, the consent section is hidden; but resetting state is harmless.
    setConsentSubmitState(false);
  }
}

/**
 * Parse text to extract headline and body
 * @param {string} text - The raw text that may contain "headline:" and "text:" markers
 * @returns {Object} - { title: string|null, body: string }
 */
function parseTextWithTitle(text) {
  if (!text || typeof text !== 'string') {
    return { title: null, body: text || '' };
  }

  // Try to match the pattern: headline: [title]\n\ntext: [body]
  // First, check if both headline and text markers exist
  const hasHeadline = /^headline:\s*/i.test(text);
  const hasTextMarker = /\n\ntext:\s*/i.test(text) || /^text:\s*/i.test(text);

  if (hasHeadline && hasTextMarker) {
    // Extract headline (everything after "headline:" until "\n\ntext:")
    const headlineMatch = text.match(/^headline:\s*(.+?)(?:\n\ntext:|$)/is);
    // Extract text body (everything after "text:")
    const textMatch = text.match(/(?:^headline:.*?\n\ntext:|^text:)\s*(.+)$/is);
    
    if (headlineMatch && textMatch) {
      return {
        title: headlineMatch[1].trim(),
        body: textMatch[1].trim()
      };
    }
  } else if (hasTextMarker) {
    // Only text marker found (no headline)
    const textMatch = text.match(/^text:\s*(.+)$/is);
    if (textMatch) {
      return {
        title: null,
        body: textMatch[1].trim()
      };
    }
  }
  
  // No pattern matches, return original text as body
  return {
    title: null,
    body: text.trim()
  };
}

/**
 * Show the survey form (after consent)
 */
function showSurvey() {
  // Hide consent, show survey
  document.getElementById('consent-section').style.display = 'none';
  document.getElementById('survey-section').style.display = 'block';
  const initialPage = startFromTextPage ? 2 : 1;
  startFromTextPage = false;
  showSurveyPage(initialPage);
  
  // Display the assigned text
  if (!assignedText || !assignedText.text_id) {
    showError('Text is not assigned yet. Please wait a moment and refresh if it persists.');
    return;
  }
  if (textsMap[assignedText.text_id] && textsMap[assignedText.text_id].text) {
    renderAssignedText();
    return;
  }
  showError(
    'Text not found in texts.json for text_id=' +
      assignedText.text_id +
      '. This usually means your GitHub Pages is still serving an old texts.json. ' +
      'Try hard refresh (Ctrl+Shift+R) and reload.'
  );
}

/**
 * Handle consent form submission
 */
function handleConsent(event) {
  event.preventDefault();
  
  const codeInput = document.getElementById('participant-code');
  const ageCheckEl = document.getElementById('age-check');
  const understoodCheckEl = document.getElementById('understood-check');
  const voluntaryCheckEl = document.getElementById('voluntary-check');
  const ageCheck = !!(ageCheckEl && ageCheckEl.checked);
  const understoodCheck = !!(understoodCheckEl && understoodCheckEl.checked);
  const voluntaryCheck = !!(voluntaryCheckEl && voluntaryCheckEl.checked);
  const code = codeInput ? String(codeInput.value || '').trim() : '';

  if (!code || code.length < 4) {
    alert('Please enter an anonymous participant code (at least 4 characters). Do not use your real name/ID.');
    try { codeInput && codeInput.focus(); } catch (e) {}
    return;
  }
  
  if (!ageCheck || !understoodCheck || !voluntaryCheck) {
    alert('Please confirm all three items (18+, read & understood, and voluntary participation) to continue.');
    return;
  }
  
  participantCode = code;
  try { sessionStorage.setItem(SESSION_PARTICIPANT_CODE_KEY, participantCode); } catch (e) {}

  consentGiven = true;

  // Start a new 5-text session
  completedCount = 0;
  try { sessionStorage.setItem(SESSION_COMPLETED_COUNT_KEY, String(completedCount)); } catch (e) {}
  updateProgressIndicator();

  // Clear old errors (if any)
  const errorDiv = document.getElementById('error-message');
  if (errorDiv) {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
  }

  // Ensure we have an assignment before showing the survey.
  if (assignedText && assignedText.text_id) {
    showSurvey();
    return;
  }
  setConsentSubmitState(true, 'Assigning a text...');
  requestAssignment();
}

function resetForNewParticipation() {
  assignedText = null;
  try { sessionStorage.removeItem(SESSION_ASSIGNED_TEXT_KEY); } catch (e) {}

  // Start a new 5-text session (same participant code)
  completedCount = 0;
  try { sessionStorage.setItem(SESSION_COMPLETED_COUNT_KEY, String(completedCount)); } catch (e) {}
  updateProgressIndicator();

  // Preserve page-1 background answers so "Participate Again" can start from the text page.
  const bg = {
    gender: '',
    age: '',
    education: '',
    socialMediaTime: '',
    country: ''
  };
  try {
    const genderEl = document.getElementById('gender');
    const ageEl = document.getElementById('age');
    const educationEl = document.getElementById('education');
    const smtEl = document.getElementById('social-media-time');
    const countryEl = document.getElementById('country');
    bg.gender = genderEl ? String(genderEl.value || '') : '';
    bg.age = ageEl ? String(ageEl.value || '') : '';
    bg.education = educationEl ? String(educationEl.value || '') : '';
    bg.socialMediaTime = smtEl ? String(smtEl.value || '') : '';
    bg.country = countryEl ? String(countryEl.value || '') : '';
  } catch (e) {}

  // Reset survey form UI (keep participant code in the input for convenience)
  try {
    const form = document.getElementById('survey-form');
    if (form && typeof form.reset === 'function') form.reset();
  } catch (e) {}

  // Ensure the submit button is usable (it may be left in "Submitting..." state from the previous run)
  try {
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
  } catch (e) {}

  // Restore background answers
  try {
    const genderEl2 = document.getElementById('gender');
    const ageEl2 = document.getElementById('age');
    const educationEl2 = document.getElementById('education');
    const smtEl2 = document.getElementById('social-media-time');
    const countryEl2 = document.getElementById('country');
    if (genderEl2) genderEl2.value = bg.gender;
    if (ageEl2) ageEl2.value = bg.age;
    if (educationEl2) educationEl2.value = bg.education;
    if (smtEl2) smtEl2.value = bg.socialMediaTime;
    if (countryEl2) countryEl2.value = bg.country;
  } catch (e) {}

  updatePurposeFreeTextVisibility();

  // Move user to the text page while we fetch a new text
  document.getElementById('success-section').style.display = 'none';
  document.getElementById('survey-section').style.display = 'block';
  startFromTextPage = true;
  showSurveyPage(2);

  // Show a lightweight loading hint in the text area
  try {
    const titleEl = document.getElementById('text-title');
    const contentEl = document.getElementById('text-content');
    if (titleEl) {
      titleEl.textContent = '';
      titleEl.style.display = 'none';
      titleEl.classList.remove('has-title');
    }
    if (contentEl) {
      contentEl.classList.remove('has-title');
      contentEl.textContent = 'Loading...';
    }
  } catch (e) {}

  requestAssignment();
}

function validateSurveyPage1() {
  const gender = document.getElementById('gender');
  const age = document.getElementById('age');
  const education = document.getElementById('education');
  const socialMediaTime = document.getElementById('social-media-time');
  const country = document.getElementById('country');

  if (gender && !gender.value) {
    alert('Please select your gender.');
    gender.focus();
    return false;
  }
  if (age && !age.value) {
    alert('Please enter your age.');
    age.focus();
    return false;
  }
  if (education && !education.value) {
    alert('Please select your education level.');
    education.focus();
    return false;
  }
  if (socialMediaTime && !socialMediaTime.value) {
    alert('Please select your daily social media time.');
    socialMediaTime.focus();
    return false;
  }
  if (country && !String(country.value || '').trim()) {
    alert('Please enter your country.');
    country.focus();
    return false;
  }
  return true;
}

function handleNextPage() {
  if (!validateSurveyPage1()) return;
  showSurveyPage(2);
}

function handleBackPage() {
  showSurveyPage(1);
}

/**
 * Handle survey form submission
 */
async function handleSurveySubmit(event) {
  event.preventDefault();

  // With novalidate enabled, we must validate page-1 fields here as well (in case the user skips UI flow).
  if (!validateSurveyPage1()) {
    showSurveyPage(1);
    return;
  }
  
  // Collect all form data
  const topicFamiliarityEl = document.querySelector('input[name="topic-familiarity"]:checked');
  const understandingEl = document.querySelector('input[name="understanding"]:checked');
  const credibilityEl = document.querySelector('input[name="credibility"]:checked');
  const shareabilityEl = document.querySelector('input[name="shareability"]:checked');
  const intentStrengthEl = document.querySelector('input[name="intent-strength"]:checked');
  const beliefChangeEl = document.querySelector('input[name="belief-change"]:checked');
  
  const formData = {
    participant_code: participantCode,
    allocation_id: assignedText && assignedText.allocation_id ? assignedText.allocation_id : '',
    text_id: assignedText.text_id,
    topic: assignedText.topic,
    gender: document.getElementById('gender').value,
    age: document.getElementById('age').value,
    education: document.getElementById('education').value,
    social_media_time: document.getElementById('social-media-time').value,
    country: (document.getElementById('country').value || '').trim(),
    topic_familiarity: topicFamiliarityEl ? topicFamiliarityEl.value : '',
    understanding: understandingEl ? understandingEl.value : '',
    credibility: credibilityEl ? credibilityEl.value : '',
    willingness_to_share: shareabilityEl ? shareabilityEl.value : '',
    intent_strength: intentStrengthEl ? intentStrengthEl.value : '',
    belief_change: beliefChangeEl ? beliefChangeEl.value : '',
    purpose: document.getElementById('purpose-text').value || ''
  };
  
  // Validate required fields
  const intentStrength = intentStrengthEl ? parseInt(intentStrengthEl.value, 10) : 0;
  const purposeRequired = intentStrength >= 2;
  
  if (
    !formData.topic_familiarity ||
    !formData.understanding ||
    !formData.credibility ||
    !formData.willingness_to_share ||
    !formData.intent_strength ||
    !formData.belief_change ||
    (purposeRequired && !formData.purpose.trim())
  ) {
    const missing = [];
    if (!formData.understanding) missing.push('Understanding');
    if (!formData.credibility) missing.push('Credibility');
    if (!formData.willingness_to_share) missing.push('Willingness to Share');
    if (!formData.intent_strength) missing.push('Intent Strength');
    if (!formData.belief_change) missing.push('Belief Change');
    if (purposeRequired && !formData.purpose.trim()) missing.push('Purpose (4.2)');
    if (!formData.topic_familiarity) missing.push('Topic Familiarity');

    alert('Please answer all required questions: ' + missing.join(', ') + '.');
    return;
  }
  
  // Disable submit button
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  setSkipButtonState(true, 'Submitting...');
  
  try {
    // Submit to Apps Script
    const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      // IMPORTANT: Use a "simple" content-type to avoid CORS preflight issues with Apps Script Web Apps.
      // The body is still JSON; the server parses e.postData.contents.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(formData)
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Submission failed (HTTP ${response.status}). ${text}`.trim());
    }
    
    let result;
    try {
      result = await response.json();
    } catch (e) {
      const text = await response.text().catch(() => '');
      throw new Error(`Invalid JSON response from server. ${text}`.trim());
    }
    
    if (result.error) {
      throw new Error(result.error);
    }
 
    // Submission succeeded for this text
    completedCount += 1;
    try { sessionStorage.setItem(SESSION_COMPLETED_COUNT_KEY, String(completedCount)); } catch (e) {}

    if (completedCount >= TARGET_TEXT_COUNT) {
      // Finished all texts
      document.getElementById('survey-section').style.display = 'none';
      document.getElementById('success-section').style.display = 'block';
      assignedText = null;
      try { sessionStorage.removeItem(SESSION_ASSIGNED_TEXT_KEY); } catch (e) {}
      return;
    }

    // Continue to next text (stay in survey, page 2)
    setSurveySubmitState(true, 'Loading next text...');
    setSkipButtonState(true, 'Loading next text...');
    resetPage2Answers();
    assignedText = null;
    try { sessionStorage.removeItem(SESSION_ASSIGNED_TEXT_KEY); } catch (e) {}
    updateProgressIndicator();
    showSurveyPage(2);
    requestAssignment();
    return;
    
  } catch (err) {
    console.error('Submission error:', err);
    const msg = (err && err.message) ? err.message : String(err);
    alert('Failed to submit responses: ' + msg);
    setSurveySubmitState(false);
    setSkipButtonState(false);
  }
}

async function handleSkipText() {
  // Safety: ensure background fields are present even if user reaches page 2 unexpectedly.
  if (!validateSurveyPage1()) {
    showSurveyPage(1);
    return;
  }

  if (!assignedText || !assignedText.text_id) {
    alert('No text is currently assigned. Please wait a moment and try again.');
    return;
  }

  const ok = confirm(
    'Skip this text due to display/content issues?\n\n' +
    'We will record this issue and move you to the next text.'
  );
  if (!ok) return;

  const detail = prompt('Please briefly describe the issue (required):', '');
  if (detail == null) return; // user cancelled
  const reasonDetail = String(detail || '').trim();
  if (!reasonDetail) {
    alert('Reason is required to skip.');
    return;
  }

  // Lock UI to prevent double submissions.
  setSurveySubmitState(true, 'Skipping...');
  setSkipButtonState(true, 'Skipping...');

  const payload = {
    participant_code: participantCode,
    allocation_id: assignedText && assignedText.allocation_id ? assignedText.allocation_id : '',
    text_id: assignedText.text_id,
    topic: assignedText.topic,
    // Keep background fields (useful for analysis)
    gender: document.getElementById('gender').value,
    age: document.getElementById('age').value,
    education: document.getElementById('education').value,
    social_media_time: document.getElementById('social-media-time').value,
    country: (document.getElementById('country').value || '').trim(),
    // Skip/anomaly markers
    skipped_due_to_display_issue: '1',
    skip_reason: 'display_issue',
    skip_reason_detail: reasonDetail
  };

  try {
    const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Skip submission failed (HTTP ${response.status}). ${text}`.trim());
    }

    let result;
    try {
      result = await response.json();
    } catch (e) {
      const text = await response.text().catch(() => '');
      throw new Error(`Invalid JSON response from server. ${text}`.trim());
    }
    if (result && result.error) throw new Error(result.error);

    // Consider skipped text as "completed" and move on.
    completedCount += 1;
    try { sessionStorage.setItem(SESSION_COMPLETED_COUNT_KEY, String(completedCount)); } catch (e) {}

    if (completedCount >= TARGET_TEXT_COUNT) {
      document.getElementById('survey-section').style.display = 'none';
      document.getElementById('success-section').style.display = 'block';
      assignedText = null;
      try { sessionStorage.removeItem(SESSION_ASSIGNED_TEXT_KEY); } catch (e) {}
      return;
    }

    // Continue to next text (stay in survey, page 2)
    setSurveySubmitState(true, 'Loading next text...');
    setSkipButtonState(true, 'Loading next text...');
    resetPage2Answers();
    assignedText = null;
    try { sessionStorage.removeItem(SESSION_ASSIGNED_TEXT_KEY); } catch (e) {}
    updateProgressIndicator();
    showSurveyPage(2);
    requestAssignment();
    return;
  } catch (err) {
    console.error('Skip submission error:', err);
    const msg = (err && err.message) ? err.message : String(err);
    alert('Failed to record skip: ' + msg);
    setSurveySubmitState(false);
    setSkipButtonState(false);
  }
}

/**
 * Show error message
 */
function showError(message) {
  const errorDiv = document.getElementById('error-message');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    try { window.scrollTo(0, 0); } catch (e) {}
  } else {
    alert(message);
  }
}

// Attach event listeners
function onById(id, eventName, handler) {
  const el = document.getElementById(id);
  if (el && typeof el.addEventListener === 'function') {
    el.addEventListener(eventName, handler);
  }
}

function handleDone() {
  // End of the 5-text session. Keep UI simple: return to the consent page.
  completedCount = 0;
  try { sessionStorage.removeItem(SESSION_COMPLETED_COUNT_KEY); } catch (e) {}
  assignedText = null;
  try { sessionStorage.removeItem(SESSION_ASSIGNED_TEXT_KEY); } catch (e) {}

  const success = document.getElementById('success-section');
  const survey = document.getElementById('survey-section');
  const consent = document.getElementById('consent-section');
  if (success) success.style.display = 'none';
  if (survey) survey.style.display = 'none';
  if (consent) consent.style.display = 'block';
}
onById('consent-form', 'submit', handleConsent);
onById('survey-form', 'submit', handleSurveySubmit);
onById('next-btn', 'click', handleNextPage);
onById('back-btn', 'click', handleBackPage);
onById('repeat-btn', 'click', handleDone);
onById('skip-text-btn', 'click', handleSkipText);

// Attach listeners to all intent-strength radio buttons for purpose gating
// Use event delegation on the form since radios might not exist at load time
document.addEventListener('change', function(e) {
  if (e.target && e.target.name === 'intent-strength') {
    updatePurposeFreeTextVisibility();
  }
});
updatePurposeFreeTextVisibility();
