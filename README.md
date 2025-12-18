# Human Evaluation Survey - GitHub Pages Deployment Guide

This directory contains a static survey website that can be deployed on GitHub Pages. The survey assigns one text per participant sequentially and logs responses to Google Sheets via Google Apps Script.

## Architecture

```
Participant Browser
   ↓
GitHub Pages (HTML + JS)
   ↓  fetch()
Google Apps Script (HTTPS endpoint)
   ↓
Google Sheet (stores responses)
```

## Setup Instructions

### Step 1: Prepare Google Sheet

1. Create a new Google Sheet (e.g., name it `survey_data`).

2. Create two tabs:
   - **Tab 1: `responses`** - stores survey submissions
   - **Tab 2: `assignments`** - stores participant→text mapping

3. In the `responses` tab, add this header row (row 1):
   ```
   timestamp | participant_id | text_id | topic | gender | age | education | social_media_time | topic_familiarity | credibility | willingness_to_share | has_purpose | purpose_free_text
   ```

4. In the `assignments` tab, add this header row (row 1):
   ```
   timestamp | participant_id | text_id | topic
   ```

5. Copy your **Sheet ID** from the URL:
   - URL format: `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`
   - The `YOUR_SHEET_ID` is the long string between `/d/` and `/edit`

### Step 2: Set Up Google Apps Script

1. In your Google Sheet, go to **Extensions → Apps Script**.

2. Delete the default code and paste the contents of `apps-script-code.gs`.

3. **Replace `YOUR_SHEET_ID`** in the script with your actual Sheet ID (from Step 1.5).

4. **Configure `getTextsArray()` function:**
   
   You have two options:

   **Option A: Fetch from public URL (recommended)**
   - After deploying to GitHub Pages, your `texts.json` will be publicly accessible
   - Uncomment the `UrlFetchApp.fetch()` block in `getTextsArray()`
   - Replace the URL with your GitHub Pages URL: `https://yourname.github.io/yourrepo/texts.json`

   **Option B: Store in PropertiesService (for small datasets < 9KB)**
   - Uncomment the PropertiesService block
   - Run this one-time setup function to store texts:
     ```javascript
     function setupTexts() {
       const texts = [/* your texts array */];
       PropertiesService.getScriptProperties().setProperty('texts_json', JSON.stringify(texts));
     }
     ```
   - Run `setupTexts()` once, then delete the function

5. **Deploy the Apps Script:**
   - Click **Deploy → New deployment**
   - Click the gear icon ⚙️ next to "Select type" and choose **Web app**
   - Settings:
     - **Execute as:** Me
     - **Who has access:** Anyone
   - Click **Deploy**
   - Copy the **Web App URL** (format: `https://script.google.com/macros/s/AKfycbxxxxx/exec`)
   - **Important:** You may need to authorize the script on first run (click "Authorize access")

### Step 3: Configure Frontend

1. Open `config.js` and replace `YOUR_APPS_SCRIPT_URL` with the Web App URL from Step 2.5.

2. Replace `texts.json` with your actual texts:
   - Format: Array of objects with `text_id`, `topic`, and `text` fields
   - Example:
     ```json
     [
       {
         "text_id": "A01",
         "topic": "health",
         "text": "Your actual text content here..."
       },
       {
         "text_id": "A02",
         "topic": "politics",
         "text": "Another text..."
       }
     ]
     ```
   - **Order matters:** The order in the array determines sequential assignment

### Step 4: Deploy to GitHub Pages

1. Create a new GitHub repository (or use an existing one).

2. Copy all files from this `docs/` directory to your repository:
   - `index.html`
   - `app.js`
   - `config.js`
   - `texts.json`
   - `README.md` (optional)

3. Enable GitHub Pages:
   - Go to repository **Settings → Pages**
   - Under "Source", select the branch containing your files (usually `main` or `master`)
   - Select the folder (if files are in root, select `/ (root)`; if in `docs/`, select `/docs`)
   - Click **Save**

4. Your survey will be available at:
   - `https://yourusername.github.io/your-repo-name/` (if files in root)
   - `https://yourusername.github.io/your-repo-name/` (if files in `docs/`, GitHub Pages serves from `/docs` automatically)

5. **Update Apps Script if using Option A:**
   - In `apps-script-code.gs`, update the `getTextsArray()` function with your GitHub Pages URL for `texts.json`

## Testing

1. Open your GitHub Pages URL in a browser.
2. Complete the consent form.
3. Fill out the survey and submit.
4. Check your Google Sheet to verify the response was recorded.

## Troubleshooting

### CORS Errors
- Make sure your Apps Script is deployed as a **Web app** (not just a script)
- Access should be set to **"Anyone"** (not "Only me")

### Assignment Not Working
- Check that `texts.json` is accessible at the public URL
- Verify the Sheet ID in Apps Script matches your actual Sheet
- Check Apps Script execution logs: **Executions** tab in Apps Script editor

### Responses Not Saving
- Verify the `responses` sheet tab exists and has the correct header row
- Check Apps Script execution logs for errors
- Ensure the Apps Script URL in `config.js` is correct

### Sequential Assignment Issues
- The assignment uses `PropertiesService` to track the next index
- If you need to reset, you can manually delete the property or restart from index 0
- Each participant gets a stable assignment (stored in `localStorage` and `assignments` sheet)

## Data Export

To export your data:
1. Open your Google Sheet
2. Go to **File → Download → Comma-separated values (.csv)** or use Google Sheets export features

## Security Notes

- The Apps Script URL is public (anyone with the link can submit)
- Consider adding rate limiting or authentication if needed
- Participant IDs are generated client-side (UUID) and stored in `localStorage`
- No personally identifiable information is collected (per the consent form)

## Customization

- **Styling:** Edit the `<style>` section in `index.html`
- **Questions:** Modify the form fields in `index.html` and update the `responses` sheet header accordingly
- **Text assignment:** Change the logic in `apps-script-code.gs` if you want different assignment strategies (random, balanced by topic, etc.)

