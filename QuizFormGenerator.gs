/**
 * Quiz Form Generator - Google Apps Script
 * 
 * Converts a Google Doc with questions into a Google Forms quiz.
 * 
 * INSTALLATION:
 * 1. Open your Google Doc with quiz questions
 * 2. Go to Extensions → Apps Script
 * 3. Delete any existing code and paste this entire file
 * 4. Save (Ctrl+S) and close the Apps Script editor
 * 5. Reload your Google Doc
 * 6. A new menu "Quiz Tools" will appear - click "Create Quiz Form"
 */

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Quiz Tools')
    .addItem('Create Quiz Form', 'createQuizFromDoc')
    .addItem('Preview Only', 'previewQuiz')
    .addToUi();
}

function createQuizFromDoc() {
  const doc = DocumentApp.getActiveDocument();
  const text = doc.getBody().getText();
  
  try {
    const sections = parseQuizText(text);
    const form = buildForm(doc.getName() + ' - Quiz', sections);
    
    const ui = DocumentApp.getUi();
    ui.alert('Quiz Created!', 
      'Your quiz form has been created:\n\n' + form.getEditUrl() + '\n\n' +
      'Share link for students:\n' + form.getPublishedUrl(),
      ui.ButtonSet.OK);
  } catch (e) {
    DocumentApp.getUi().alert('Error', 'Failed to create quiz: ' + e.message, DocumentApp.getUi().ButtonSet.OK);
  }
}

function previewQuiz() {
  const doc = DocumentApp.getActiveDocument();
  const text = doc.getBody().getText();
  
  try {
    const sections = parseQuizText(text);
    let preview = 'Parsed Quiz Structure:\n\n';
    
    sections.forEach((section, i) => {
      preview += `Section ${i + 1}: ${section.title} (${section.kind || 'auto'})\n`;
      section.questions.forEach((q, j) => {
        preview += `  Q${j + 1}: ${q.title.substring(0, 50)}... [${q.type}]\n`;
        if (q.options && q.options.length > 0) {
          preview += `    Options: ${q.options.join(', ')}\n`;
        }
        if (q.answer) {
          preview += `    Answer: ${q.answer}\n`;
        }
      });
      preview += '\n';
    });
    
    DocumentApp.getUi().alert('Preview', preview, DocumentApp.getUi().ButtonSet.OK);
  } catch (e) {
    DocumentApp.getUi().alert('Error', 'Failed to parse: ' + e.message, DocumentApp.getUi().ButtonSet.OK);
  }
}

// ============ PARSER ============

/**
 * Extract question number from a line like "1. What is..." or "15. True"
 */
function extractQuestionNumber(line) {
  const match = line.match(/^(\d+)\s*[\.:)]/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse the answer key section and return a map of question number to answer value
 */
function parseAnswerKey(lines, startIndex) {
  const answers = {};
  // Pattern: "1. B – explanation" or "11. True" or "16. CTR vs TMA: explanation"
  const ANSWER_LINE_RE = /^(\d+)\s*[\.:)]\s*(.+)$/;
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.match(/^[_-]{3,}$/)) continue;
    
    const match = line.match(ANSWER_LINE_RE);
    if (match) {
      const qNum = parseInt(match[1], 10);
      let answerText = match[2].trim();
      
      // Extract just the letter if format is "B – explanation" or "B - explanation"
      const letterMatch = answerText.match(/^([A-Ha-h])\s*[–\-—]\s*/i);
      if (letterMatch) {
        answers[qNum] = letterMatch[1].toUpperCase();
      } else {
        // For True/False or short answer, use the full text
        // But clean up any trailing explanation in parentheses for T/F
        const tfMatch = answerText.match(/^(true|false)\b/i);
        if (tfMatch) {
          answers[qNum] = tfMatch[1].charAt(0).toUpperCase() + tfMatch[1].slice(1).toLowerCase();
        } else {
          answers[qNum] = answerText;
        }
      }
    }
  }
  
  return answers;
}

function parseQuizText(text) {
  // Strip BOM (Byte Order Mark) that Google Docs may add
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  const sections = [];
  let currentSection = null;
  let currentQuestion = null;
  let currentOptions = [];
  let currentAnswer = null;
  let currentQuestionNumber = null;
  
  // Answer key header detection
  const ANSWER_KEY_HEADER_RE = /^(?:answer\s*key|answers?)\s*$/i;
  
  // First pass: find answer key section and parse it
  let answerKeyStartIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (ANSWER_KEY_HEADER_RE.test(stripped)) {
      answerKeyStartIndex = i + 1;
      break;
    }
  }
  
  const answerKeyMap = answerKeyStartIndex >= 0 ? parseAnswerKey(lines, answerKeyStartIndex) : {};
  
  // Markdown heading (for .md files)
  const HEADING_RE = /^#{1,6}\s+(.*)$/;
  // Markdown bold line
  const BOLD_LINE_RE = /^\*\*(.+?)\*\*\s*$/;
  // Match options like "A." or "A)" with optional space after the delimiter (case-insensitive)
  const OPTION_RE = /^([A-Ha-h])[\.)]\s*(.*)$/i;
  // Answer line
  const ANSWER_RE = /^\s*(?:\*\*)?(?:answer|correct\s*answer|ans)\s*[:：]\s*(.+?)\s*(?:\*\*)?\s*$/i;
  // Question number at start
  const QUESTION_NUM_RE = /^\d+\s*[\.:)]\s*/;
  // Detect section headers like "Part 1", "Part 2", "Section 1" etc. (works for both plain text and markdown)
  const SECTION_HEADER_RE = /^(part|section)\s+\d+/i;
  // Google Docs horizontal rule (underscores)
  const GDOC_HR_RE = /^[_]{3,}$/;
  
  function stripMarkdown(str) {
    return str.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\\\./g, '.').replace(/\s+/g, ' ').trim();
  }
  
  function getSectionKind(title) {
    const t = title.toLowerCase();
    if (t.includes('true') && t.includes('false')) return 'true_false';
    if (t.includes('short') && t.includes('answer')) return 'short_answer';
    if (t.includes('multiple') && t.includes('choice')) return 'multiple_choice';
    return null;
  }
  
  function isSectionHeader(text) {
    return SECTION_HEADER_RE.test(text);
  }

  function extractInlineOptions(line) {
    const re = /([A-Ha-h])[\.)]\s*/g;
    const spans = [];
    let m;
    while ((m = re.exec(line)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
    if (spans.length < 2) return null;

    const options = [];
    for (let i = 0; i < spans.length; i++) {
      const start = spans[i].end;
      const end = i + 1 < spans.length ? spans[i + 1].start : line.length;
      const value = line.slice(start, end).trim();
      if (value) options.push(stripMarkdown(value));
    }

    return options.length >= 2 ? options : null;
  }
  
  function flushQuestion() {
    if (!currentQuestion) return;
    
    if (!currentSection) {
      currentSection = { title: 'Questions', kind: null, questions: [] };
      sections.push(currentSection);
    }
    
    const kind = currentSection.kind;
    let qtype;
    
    if (kind === 'short_answer') {
      qtype = 'short_answer';
    } else if (kind === 'true_false') {
      qtype = 'true_false';
    } else if (currentOptions.length > 0) {
      qtype = 'multiple_choice';
    } else {
      qtype = 'short_answer';
    }
    
    const q = { title: currentQuestion.title, type: qtype };
    
    if (qtype === 'multiple_choice') {
      q.options = currentOptions.slice();
    }
    if (qtype === 'true_false') {
      q.options = ['True', 'False'];
    }
    // Apply answer from inline or from answer key map
    if (currentAnswer) {
      q.answer = currentAnswer;
    } else if (currentQuestionNumber && answerKeyMap[currentQuestionNumber]) {
      q.answer = answerKeyMap[currentQuestionNumber];
    }
    
    currentSection.questions.push(q);
    currentQuestion = null;
    currentOptions = [];
    currentAnswer = null;
    currentQuestionNumber = null;
  }
  
  // Stop parsing at answer key section if found
  const parseEndIndex = answerKeyStartIndex >= 0 ? answerKeyStartIndex - 1 : lines.length;
  
  for (let i = 0; i < parseEndIndex; i++) {
    const line = lines[i];
    const stripped = line.trim().replace(/^[\uFEFF\u200B-\u200F]+/, '');
    
    // Skip empty lines, markdown HRs (---), and Google Docs HRs (___)
    if (!stripped || stripped.match(/^-{3,}$/) || GDOC_HR_RE.test(stripped)) continue;
    
    // Check for markdown heading (# or ## or ###)
    const headingMatch = stripped.match(HEADING_RE);
    if (headingMatch) {
      const level = (stripped.match(/^#+/) || [''])[0].length;
      const text = stripMarkdown(headingMatch[1]);
      
      if (level <= 2 || (level === 3 && isSectionHeader(text))) {
        flushQuestion();
        currentSection = { title: text, kind: getSectionKind(text), questions: [] };
        sections.push(currentSection);
        continue;
      }
      
      // Level 3+ heading - likely a question
      if (text.match(/^\d+/) || QUESTION_NUM_RE.test(text)) {
        flushQuestion();
        currentQuestion = { title: text };
        currentQuestionNumber = extractQuestionNumber(text);
        continue;
      }
    }
    
    // Check for plain text section header (e.g., "Part 1 – Multiple choice")
    // This handles Google Docs plain text format
    if (isSectionHeader(stripped)) {
      flushQuestion();
      currentSection = { title: stripped, kind: getSectionKind(stripped), questions: [] };
      sections.push(currentSection);
      continue;
    }
    
    // Check for markdown bold section header
    const boldMatch = stripped.match(BOLD_LINE_RE);
    if (boldMatch) {
      const text = stripMarkdown(boldMatch[1]);
      if (isSectionHeader(text)) {
        flushQuestion();
        currentSection = { title: text, kind: getSectionKind(text), questions: [] };
        sections.push(currentSection);
        continue;
      }
    }
    
    // Check for question number at start of line (e.g., "1. What is...")
    if (stripped.match(/^\d+\s*[\.:)]/)) {
      // Don't start a new question if this looks like an option line that happens to start with a number
      // Only treat as question if it doesn't match option pattern
      if (!OPTION_RE.test(stripped)) {
        flushQuestion();
        currentQuestion = { title: stripMarkdown(stripped) };
        currentQuestionNumber = extractQuestionNumber(stripped);
        continue;
      }
    }
    
    if (!currentQuestion) continue;
    
    // Check for answer line
    const answerMatch = stripped.match(ANSWER_RE);
    if (answerMatch) {
      currentAnswer = stripMarkdown(answerMatch[1]);
      continue;
    }
    
    // Check for options (A. B. C. etc) - may be on a single line or separate lines.
    // Don't require the option marker to be at the beginning of the line, since Google Docs
    // can include invisible directionality chars or other prefixes.
    const inlineOptions = extractInlineOptions(stripped);
    if (inlineOptions) {
      inlineOptions.forEach(opt => currentOptions.push(opt));
      continue;
    }

    const optionMatch = stripped.match(/^[^A-Ha-h]*([A-Ha-h])[\.)]\s*(.*)$/i);
    if (optionMatch && optionMatch[2].trim()) {
      currentOptions.push(stripMarkdown(optionMatch[2]));
      continue;
    }
  }
  
  flushQuestion();
  
  return sections.filter(s => s.questions.length > 0);
}

// ============ FORM BUILDER ============

function buildForm(title, sections) {
  const form = FormApp.create(title);
  form.setIsQuiz(true);
  applyResponseSettings_(form);
  
  for (const section of sections) {
    // Add section header as a page break (except for first section)
    if (sections.indexOf(section) > 0) {
      form.addPageBreakItem().setTitle(section.title);
    } else {
      form.setDescription('Section: ' + section.title);
    }
    
    for (const q of section.questions) {
      if (q.type === 'multiple_choice') {
        addMultipleChoice(form, q);
      } else if (q.type === 'true_false') {
        addTrueFalse(form, q);
      } else {
        addShortAnswer(form, q);
      }
    }
  }
  
  return form;
}

function applyResponseSettings_(form) {
  // Matches the “Responses” settings shown in the screenshot.
  // Note: Response receipts (“send responders a copy…”) is not available via FormApp,
  // so we best-effort set it via the Google Forms API; if that fails, form creation still succeeds.
  form.setCollectEmail(true);

  // Verified email collection requires sign-in; some accounts/orgs may restrict this setting.
  try {
    if (typeof form.setRequireLogin === 'function') {
      form.setRequireLogin(true);
    }
  } catch (e) {
    // Ignore; some accounts/orgs may disallow requiring sign-in.
  }

  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(false);

  try {
    setResponseReceiptsWhenRequested_(form.getId());
  } catch (e) {
    // Ignore; the form is still usable. (Common cause: Forms API not enabled for the Apps Script project.)
    Logger.log('Failed to set response receipts (non-critical): ' + (e && e.message ? e.message : e));
  }
}

function setResponseReceiptsWhenRequested_(formId) {
  const url = 'https://forms.googleapis.com/v1/forms/' + encodeURIComponent(formId) + ':batchUpdate';
  const payload = {
    requests: [
      {
        updateSettings: {
          settings: {
            responseReceipts: 'WHEN_REQUESTED'
          },
          updateMask: 'responseReceipts'
        }
      }
    ]
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Forms API batchUpdate failed: HTTP ' + code + ' - ' + res.getContentText());
  }
}

function addMultipleChoice(form, q) {
  const item = form.addMultipleChoiceItem();
  item.setTitle(q.title);
  item.setRequired(true);
  
  const choices = q.options.map(opt => {
    const isCorrect = q.answer && normalizeAnswer(q.answer, q.options) === opt;
    return item.createChoice(opt, isCorrect);
  });
  
  item.setChoices(choices);
  
  if (q.answer) {
    item.setPoints(1);
  }
}

function addTrueFalse(form, q) {
  const item = form.addMultipleChoiceItem();
  item.setTitle(q.title);
  item.setRequired(true);
  
  const normalizedAnswer = normalizeTrueFalse(q.answer);
  
  const choices = [
    item.createChoice('True', normalizedAnswer === 'True'),
    item.createChoice('False', normalizedAnswer === 'False')
  ];
  
  item.setChoices(choices);
  
  if (normalizedAnswer) {
    item.setPoints(1);
  }
}

function addShortAnswer(form, q) {
  const item = form.addTextItem();
  item.setTitle(q.title);
  item.setRequired(true);
}

function normalizeAnswer(answer, options) {
  const a = answer.trim();
  
  // Check if answer is a letter (A, B, C, etc.)
  if (a.length === 1 && a.toUpperCase() >= 'A' && a.toUpperCase() <= 'H') {
    const idx = a.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    if (idx >= 0 && idx < options.length) {
      return options[idx];
    }
  }
  
  // Try to match by text
  for (const opt of options) {
    if (opt.trim().toLowerCase() === a.toLowerCase()) {
      return opt;
    }
  }
  
  return null;
}

function normalizeTrueFalse(answer) {
  if (!answer) return null;
  const a = answer.trim().toLowerCase();
  if (a === 't' || a === 'true') return 'True';
  if (a === 'f' || a === 'false') return 'False';
  return null;
}
