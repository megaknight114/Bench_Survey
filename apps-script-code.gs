/**
 * Google Apps Script for Survey Backend
 * 
 * SETUP INSTRUCTIONS:
 * 1. Create a Google Sheet with two tabs: "responses" and "assignments"
 * 2. In "responses" tab, add header row:
 *    timestamp, participant_id, text_id, topic, gender, age, education, social_media_time, topic_familiarity, credibility, willingness_to_share, has_purpose, purpose_free_text
 * 3. In "assignments" tab, add header row:
 *    timestamp, participant_id, text_id, topic
 * 4. Replace YOUR_SHEET_ID below with your Sheet ID (from the URL)
 * 5. Deploy as Web App: Execute as "Me", Access "Anyone"
 */

// REPLACE THIS WITH YOUR GOOGLE SHEET ID
const SHEET_ID = 'YOUR_SHEET_ID';

// Property key for storing the next text index
const NEXT_TEXT_INDEX_KEY = 'next_text_index';

/**
 * Handle GET requests for text assignment
 * Query params: participant_id
 * Returns JSON: {text_id, topic} or {error: "message"}
 */
function doGet(e) {
  try {
    const participantId = e.parameter.participant_id;
    if (!participantId) {
      return ContentService
        .createTextOutput(JSON.stringify({error: 'Missing participant_id'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const assignmentsSheet = sheet.getSheetByName('assignments');
    
    if (!assignmentsSheet) {
      return ContentService
        .createTextOutput(JSON.stringify({error: 'Assignments sheet not found'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Check if participant already has an assignment
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000); // Wait up to 10 seconds
      
      const existingAssignment = findExistingAssignment(assignmentsSheet, participantId);
      if (existingAssignment) {
        lock.releaseLock();
        return ContentService
          .createTextOutput(JSON.stringify(existingAssignment))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // Load texts.json from a public URL or embed in script
      // For now, we'll use PropertiesService to store the texts array
      // You can also fetch from a public URL if you host texts.json
      const texts = getTextsArray();
      if (!texts || texts.length === 0) {
        lock.releaseLock();
        return ContentService
          .createTextOutput(JSON.stringify({error: 'No texts available'}))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // Get next index (thread-safe)
      const props = PropertiesService.getScriptProperties();
      let nextIndex = parseInt(props.getProperty(NEXT_TEXT_INDEX_KEY) || '0');
      
      if (nextIndex >= texts.length) {
        lock.releaseLock();
        return ContentService
          .createTextOutput(JSON.stringify({error: 'All texts have been assigned'}))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const assignedText = texts[nextIndex];
      nextIndex++;
      props.setProperty(NEXT_TEXT_INDEX_KEY, nextIndex.toString());

      // Record assignment
      assignmentsSheet.appendRow([
        new Date(),
        participantId,
        assignedText.text_id,
        assignedText.topic
      ]);

      lock.releaseLock();

      return ContentService
        .createTextOutput(JSON.stringify({
          text_id: assignedText.text_id,
          topic: assignedText.topic
        }))
        .setMimeType(ContentService.MimeType.JSON);

    } catch (lockError) {
      lock.releaseLock();
      return ContentService
        .createTextOutput(JSON.stringify({error: 'Assignment lock timeout'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({error: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle POST requests for survey responses
 * Body: JSON with all response fields
 */
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const responsesSheet = sheet.getSheetByName('responses');
    
    if (!responsesSheet) {
      return ContentService
        .createTextOutput(JSON.stringify({error: 'Responses sheet not found'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Parse request body
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      return ContentService
        .createTextOutput(JSON.stringify({error: 'No data provided'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Append response row
    responsesSheet.appendRow([
      new Date(),
      data.participant_id || '',
      data.text_id || '',
      data.topic || '',
      data.gender || '',
      data.age || '',
      data.education || '',
      data.social_media_time || '',
      data.topic_familiarity || '',
      data.credibility || '',
      data.willingness_to_share || '',
      data.has_purpose || '',
      data.purpose_free_text || ''
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({status: 'ok'}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({error: error.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Helper: Find existing assignment for a participant
 */
function findExistingAssignment(assignmentsSheet, participantId) {
  const data = assignmentsSheet.getDataRange().getValues();
  if (data.length < 2) return null; // No header or data

  // Search from bottom up (most recent first)
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][1] === participantId) { // participant_id is column B (index 1)
      return {
        text_id: data[i][2],
        topic: data[i][3]
      };
    }
  }
  return null;
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
  // Option 1: Fetch from public URL (recommended)
  // Uncomment and replace with your texts.json URL:
  /*
  try {
    const response = UrlFetchApp.fetch('https://yourname.github.io/yourrepo/texts.json');
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log('Error fetching texts: ' + e.toString());
    return [];
  }
  */

  // Option 2: Store in PropertiesService (for small datasets, < 9KB total)
  // Uncomment and populate:
  /*
  const props = PropertiesService.getScriptProperties();
  const textsJson = props.getProperty('texts_json');
  if (textsJson) {
    return JSON.parse(textsJson);
  }
  */

  // Placeholder - replace with one of the options above
  return [];
}

