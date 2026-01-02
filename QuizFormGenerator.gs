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
    .addItem('Debug Raw Text', 'debugRawText')
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

function debugRawText() {
  const doc = DocumentApp.getActiveDocument();
  const text = doc.getBody().getText();
  const lines = text.replace(/^\uFEFF/, '').split('\n').slice(0, 10);
  let debug = 'First 10 lines (raw):\n\n';
  lines.forEach((line, i) => {
    debug += `${i}: [${line.trim()}]\n`;
  });
  DocumentApp.getUi().alert('Debug', debug, DocumentApp.getUi().ButtonSet.OK);
}

// ============ PARSER ============

function parseQuizText(text) {
  // Strip BOM (Byte Order Mark) that Google Docs may add
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  const sections = [];
  let currentSection = null;
  let currentQuestion = null;
  let currentOptions = [];
  let currentAnswer = null;
  
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
    if (currentAnswer) {
      q.answer = currentAnswer;
    }
    
    currentSection.questions.push(q);
    currentQuestion = null;
    currentOptions = [];
    currentAnswer = null;
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();
    
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
    
    // Check for options (A. B. C. etc) - may be on single line or separate lines
    const optionMatch = stripped.match(OPTION_RE);
    if (optionMatch) {
      // Check if multiple options are on the same line (e.g., "A. foo B. bar C. baz")
      const inlineOptions = stripped.match(/([A-Ha-h])[\.)]\s*([^A-Ha-h]+?)(?=\s+[A-Ha-h][\.\)]|$)/gi);
      if (inlineOptions && inlineOptions.length > 1) {
        // Multiple options on same line
        inlineOptions.forEach(opt => {
          const m = opt.match(/^([A-Ha-h])[\.)]\s*(.*)$/i);
          if (m && m[2].trim()) {
            currentOptions.push(m[2].trim());
          }
        });
      } else {
        // Single option on this line
        currentOptions.push(stripMarkdown(optionMatch[2]));
      }
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
