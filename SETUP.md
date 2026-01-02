# Quiz Form Generator - Setup Guide

Convert a Google Doc with questions into a Google Forms quiz in seconds.

## Quick Setup (5 minutes)

### Step 1: Open Your Google Doc
Open the Google Doc containing your quiz questions.

### Step 2: Open Apps Script Editor
Go to **Extensions** → **Apps Script**

### Step 3: Add the Code
1. Delete any existing code in the editor
2. Copy the entire contents of `QuizFormGenerator.gs`
3. Paste it into the Apps Script editor
4. Press **Ctrl+S** (or Cmd+S on Mac) to save
5. Close the Apps Script tab

### Step 4: Use It
1. Reload your Google Doc (refresh the page)
2. Wait a few seconds for the menu to appear
3. Click **Quiz Tools** → **Create Quiz Form**
4. Authorize the script when prompted (first time only)
5. Your quiz form will be created automatically!

## Document Format

This script reads your **Google Doc text**. You can write questions as plain text; formatting like headings/bold is optional.

Your Google Doc should follow a structure like this:

```
Part 1 – Multiple Choice

1. What is 2 + 2?
A. 3
B. 4
C. 5
D. 6

---

Part 2 – True/False

2. The sky is blue.

---

Part 3 – Short Answer

3. Explain photosynthesis in one sentence.
```

### Supported Question Types:
- **Multiple Choice**: Questions with A/B/C/D options
- **True/False**: Detected by section title containing "true" and "false"
- **Short Answer**: Questions without options

### Answer Formats:
- Letter: `Answer: B`
- Full text: `Answer: The correct option text`
- True/False: `Answer: True` or `Answer: T`

## Reusing the Script

Once installed, the script stays with that document. To use it with another document:
1. Open the new document
2. Repeat steps 2-4 above

## Troubleshooting

**Menu doesn't appear?**
- Refresh the page and wait 5-10 seconds
- Check Extensions → Apps Script to verify the code is saved

**Authorization error?**
- Click "Advanced" → "Go to [project name] (unsafe)"
- This is normal for personal scripts

**Questions not parsed correctly?**
- Use the "Preview Only" option first to see how your doc is being parsed
- Make sure questions start with numbers (1., 2., etc.)
- Make sure options start with letters (A., B., etc.)
