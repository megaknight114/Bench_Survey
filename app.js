// Survey application logic

let participantId = null;
let assignedText = null;
let textsMap = {}; // text_id -> {text, topic}

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
      showSurvey();
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
    showSurvey();
    
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
  
  // Display the assigned text
  if (assignedText && textsMap[assignedText.text_id]) {
    document.getElementById('text-content').textContent = textsMap[assignedText.text_id].text;
  } else {
    showError('Text not found. Please refresh the page.');
  }
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
  
  showSurvey();
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
  if (!formData.topic_familiarity || !formData.credibility || !formData.willingness_to_share || !formData.has_purpose) {
    alert('Please answer all required questions.');
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
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    if (!response.ok) {
      throw new Error('Submission failed');
    }
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    // Show success message
    document.getElementById('survey-section').style.display = 'none';
    document.getElementById('success-section').style.display = 'block';
    
  } catch (err) {
    console.error('Submission error:', err);
    alert('Failed to submit responses. Please try again or contact the research team.');
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

