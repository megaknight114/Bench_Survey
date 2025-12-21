// Survey application logic

let participantId = null;
let assignedText = null;
let textsMap = {}; // text_id -> {text, topic}
let consentGiven = false;

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
  // Generate or retrieve participant ID
  participantId = localStorage.getItem('participant_id');
  if (!participantId) {
    participantId = crypto.randomUUID();
    localStorage.setItem('participant_id', participantId);
  }

  // Load texts.json
  loadTexts().then(() => {
    // Check if we already have an assignment
    const savedAssignment = localStorage.getItem('assigned_text');
    if (savedAssignment) {
      assignedText = JSON.parse(savedAssignment);
      // Only show survey after consent; otherwise wait for user to consent.
      if (consentGiven) showSurvey();
    } else {
      // Request assignment
      requestAssignment();
    }
  }).catch(err => {
    console.error('Error loading texts:', err);
    showError('Failed to load survey texts. Please refresh the page.');
  });
});

/**
 * Load texts.json from the configured URL
 */
async function loadTexts() {
  const response = await fetch(CONFIG.TEXTS_JSON_URL);
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
  try {
    const url = `${CONFIG.APPS_SCRIPT_URL}?participant_id=${encodeURIComponent(participantId)}`;
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
    localStorage.setItem('assigned_text', JSON.stringify(assignedText));
    // Only show survey after consent; avoids race where user clicks consent before assignment returns.
    if (consentGiven) showSurvey();
    
  } catch (err) {
    console.error('Assignment error:', err);
    showError('Failed to assign text. Please refresh the page.');
  }
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
    document.getElementById('text-content').textContent = textsMap[assignedText.text_id].text;
    return;
  }
  showError(
    'Text not found in texts.json for text_id=' +
      assignedText.text_id +
      '. This usually means your GitHub Pages is still serving an old texts.json, or your browser cached an old assignment. ' +
      'Try hard refresh (Ctrl+Shift+R) or clear site data/localStorage and reload.'
  );
}

/**
 * Handle consent form submission
 */
function handleConsent(event) {
  event.preventDefault();
  
  const ageCheck = document.getElementById('age-check').checked;
  const consentCheck = document.getElementById('consent-check').checked;
  
  if (!ageCheck || !consentCheck) {
    alert('Please confirm that you are at least 18 years old and agree to participate.');
    return;
  }
  
  consentGiven = true;
  // If assignment is already ready, proceed; otherwise wait for requestAssignment() to complete.
  if (assignedText) {
    showSurvey();
  } else {
    alert('Thanks. Please wait a moment while we assign a text, then click OK.');
  }
}

// For debugging/testing: clear stored participant/assignment
function resetParticipant() {
  localStorage.removeItem('participant_id');
  localStorage.removeItem('assigned_text');
  location.reload();
}

function validateSurveyPage1() {
  const gender = document.getElementById('gender');
  const age = document.getElementById('age');
  const education = document.getElementById('education');
  const socialMediaTime = document.getElementById('social-media-time');

  // Use native UI where possible
  if (gender && !gender.value) return gender.reportValidity();
  if (age && !age.value) return age.reportValidity();
  if (education && !education.value) return education.reportValidity();
  if (socialMediaTime && !socialMediaTime.value) return socialMediaTime.reportValidity();
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
  
  // Collect all form data
  const formData = {
    participant_id: participantId,
    text_id: assignedText.text_id,
    topic: assignedText.topic,
    gender: document.getElementById('gender').value,
    age: document.getElementById('age').value,
    education: document.getElementById('education').value,
    social_media_time: document.getElementById('social-media-time').value,
    topic_familiarity: document.querySelector('input[name="topic-familiarity"]:checked')?.value || '',
    credibility: document.getElementById('credibility-yes').checked ? 'Yes' : 
                 document.getElementById('credibility-no').checked ? 'No' : '',
    willingness_to_share: document.getElementById('share-yes').checked ? 'Yes' : 
                         document.getElementById('share-no').checked ? 'No' : '',
    has_purpose: document.getElementById('purpose-yes').checked ? 'Yes' : 
                 document.getElementById('purpose-no').checked ? 'No' : '',
    purpose_free_text: document.getElementById('purpose-text').value || ''
  };
  
  // Validate required fields
  if (
    !formData.topic_familiarity ||
    !formData.credibility ||
    !formData.willingness_to_share ||
    !formData.has_purpose ||
    !formData.purpose_free_text.trim()
  ) {
    // Try to trigger native required UI for the textarea if it's the missing one.
    if (!formData.purpose_free_text.trim()) {
      const el = document.getElementById('purpose-text');
      if (el && el.reportValidity) el.reportValidity();
    }
    alert('Please answer all required questions (including 3.2).');
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
  } else {
    alert(message);
  }
}

// Attach event listeners
document.getElementById('consent-form')?.addEventListener('submit', handleConsent);
document.getElementById('survey-form')?.addEventListener('submit', handleSurveySubmit);
document.getElementById('next-btn')?.addEventListener('click', handleNextPage);
document.getElementById('back-btn')?.addEventListener('click', handleBackPage);
