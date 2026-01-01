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
    .addItem('Create Quiz Form (Preview Only)', 'previewQuiz')
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
        if (q.options) {
          preview += `    Options: ${q.options.length}\n`;
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

function parseQuizText(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentSection = null;
  let currentQuestion = null;
  let currentOptions = [];
  let currentAnswer = null;
  
  const HEADING_RE = /^#{1,6}\s+(.*)$/;
  const BOLD_LINE_RE = /^\*\*(.+?)\*\*\s*$/;
  const OPTION_RE = /^\s*([A-H])[\.)]\s+(.*)$/;
  const ANSWER_RE = /^\s*(?:\*\*)?(?:answer|correct\s*answer|ans)\s*[:：]\s*(.+?)\s*(?:\*\*)?\s*$/i;
  const QUESTION_NUM_RE = /^\d+\s*[\.:)]\s*/;
  
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
    
    if (!stripped || stripped.match(/^-{3,}$/)) continue;
    
    // Check for heading (# or ## or ###)
    const headingMatch = stripped.match(HEADING_RE);
    if (headingMatch) {
      const level = (stripped.match(/^#+/) || [''])[0].length;
      const text = stripMarkdown(headingMatch[1]);
      
      if (level <= 2) {
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
    
    // Check for bold section header
    const boldMatch = stripped.match(BOLD_LINE_RE);
    if (boldMatch && !currentQuestion) {
      const text = stripMarkdown(boldMatch[1]);
      flushQuestion();
      currentSection = { title: text, kind: getSectionKind(text), questions: [] };
      sections.push(currentSection);
      continue;
    }
    
    // Check for question number at start of line
    if (!currentQuestion && stripped.match(/^\d+\s*[\.:)]/)) {
      flushQuestion();
      currentQuestion = { title: stripMarkdown(stripped) };
      continue;
    }
    
    if (!currentQuestion) continue;
    
    // Check for answer line
    const answerMatch = stripped.match(ANSWER_RE);
    if (answerMatch) {
      currentAnswer = stripMarkdown(answerMatch[1]);
      continue;
    }
    
    // Check for option (A. B. C. etc)
    const optionMatch = stripped.match(OPTION_RE);
    if (optionMatch) {
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
