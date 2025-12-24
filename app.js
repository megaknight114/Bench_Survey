// Survey application logic

let participantCode = '';
let assignedText = null;
let textsMap = {}; // text_id -> {text, topic}
let consentGiven = false;

const SESSION_ASSIGNED_TEXT_KEY = 'assigned_text';
const SESSION_PARTICIPANT_CODE_KEY = 'participant_code';

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
  const shouldShow = intentStrength >= 5;

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
    if (consentGiven) showSurvey();
    
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
  showSurveyPage(1);
  
  // Display the assigned text
  if (!assignedText || !assignedText.text_id) {
    showError('Text is not assigned yet. Please wait a moment and refresh if it persists.');
    return;
  }
  if (textsMap[assignedText.text_id] && textsMap[assignedText.text_id].text) {
    const rawText = textsMap[assignedText.text_id].text;
    const parsed = parseTextWithTitle(rawText);
    
    // Display title if it exists
    const titleEl = document.getElementById('text-title');
    const contentEl = document.getElementById('text-content');
    
    if (titleEl && contentEl) {
      if (parsed.title) {
        titleEl.textContent = parsed.title;
        titleEl.style.display = 'block';
        titleEl.classList.add('has-title');
        contentEl.classList.add('has-title');
      } else {
        titleEl.style.display = 'none';
        titleEl.classList.remove('has-title');
        contentEl.classList.remove('has-title');
      }
      
      // Display body
      contentEl.textContent = parsed.body;
    }
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

  // Reset survey form UI (keep participant code in the input for convenience)
  try {
    const form = document.getElementById('survey-form');
    if (form && typeof form.reset === 'function') form.reset();
  } catch (e) {}
  updatePurposeFreeTextVisibility();

  // Move user back to page 1 while we fetch a new text
  document.getElementById('success-section').style.display = 'none';
  document.getElementById('survey-section').style.display = 'block';
  showSurveyPage(1);

  requestAssignment();
}

function validateSurveyPage1() {
  const gender = document.getElementById('gender');
  const age = document.getElementById('age');
  const education = document.getElementById('education');
  const socialMediaTime = document.getElementById('social-media-time');

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
  
  const formData = {
    participant_code: participantCode,
    allocation_id: assignedText && assignedText.allocation_id ? assignedText.allocation_id : '',
    text_id: assignedText.text_id,
    topic: assignedText.topic,
    gender: document.getElementById('gender').value,
    age: document.getElementById('age').value,
    education: document.getElementById('education').value,
    social_media_time: document.getElementById('social-media-time').value,
    topic_familiarity: topicFamiliarityEl ? topicFamiliarityEl.value : '',
    understanding_7: understandingEl ? understandingEl.value : '',
    credibility_7: credibilityEl ? credibilityEl.value : '',
    shareability_7: shareabilityEl ? shareabilityEl.value : '',
    intent_strength_7: intentStrengthEl ? intentStrengthEl.value : '',
    purpose_free_text: document.getElementById('purpose-text').value || ''
  };
  
  // Validate required fields
  const intentStrength = intentStrengthEl ? parseInt(intentStrengthEl.value, 10) : 0;
  const purposeRequired = intentStrength >= 5;
  
  if (
    !formData.topic_familiarity ||
    !formData.understanding_7 ||
    !formData.credibility_7 ||
    !formData.shareability_7 ||
    !formData.intent_strength_7 ||
    (purposeRequired && !formData.purpose_free_text.trim())
  ) {
    const missing = [];
    if (!formData.understanding_7) missing.push('Understanding');
    if (!formData.credibility_7) missing.push('Credibility');
    if (!formData.shareability_7) missing.push('Willingness to Share');
    if (!formData.intent_strength_7) missing.push('Intent Strength');
    if (purposeRequired && !formData.purpose_free_text.trim()) missing.push('Purpose (4.2)');
    if (!formData.topic_familiarity) missing.push('Topic Familiarity');

    alert('Please answer all required questions: ' + missing.join(', ') + '.');
    return;
  }
  
  // Disable submit button
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  
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
    
    // Show success message
    document.getElementById('survey-section').style.display = 'none';
    document.getElementById('success-section').style.display = 'block';

    // Clear in-tab assignment so the next participation gets a new text
    assignedText = null;
    try { sessionStorage.removeItem(SESSION_ASSIGNED_TEXT_KEY); } catch (e) {}
    
  } catch (err) {
    console.error('Submission error:', err);
    const msg = (err && err.message) ? err.message : String(err);
    alert('Failed to submit responses: ' + msg);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
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
onById('consent-form', 'submit', handleConsent);
onById('survey-form', 'submit', handleSurveySubmit);
onById('next-btn', 'click', handleNextPage);
onById('back-btn', 'click', handleBackPage);
onById('repeat-btn', 'click', resetForNewParticipation);

// Attach listeners to all intent-strength radio buttons for purpose gating
// Use event delegation on the form since radios might not exist at load time
document.addEventListener('change', function(e) {
  if (e.target && e.target.name === 'intent-strength') {
    updatePurposeFreeTextVisibility();
  }
});
updatePurposeFreeTextVisibility();
