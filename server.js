require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const store = require('./src/store');
const extract = require('./src/extract');
const claude = require('./src/claude');
const prompts = require('./src/prompts');
const rag = require('./src/rag');
const voyage = require('./src/voyage');
const untis = require('./src/untis');

const app = express();

// Optionaler Passwortschutz (Basic Auth) für öffentliche Deployments.
// Nur aktiv, wenn APP_PASSWORD gesetzt ist – lokal ohne Passwort nutzbar.
const APP_PASSWORD = process.env.APP_PASSWORD;
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      if (pass === APP_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Lernassistent"');
    res.status(401).send('Authentifizierung erforderlich.');
  });
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  dest: store.UPLOAD_DIR,
  limits: { fileSize: 30 * 1024 * 1024, files: 20 },
});

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function asyncRoute(fn) {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(err.status || 500).json({ error: err.message || 'Interner Fehler' });
    });
  };
}

// Holt per RAG die relevantesten Materialabschnitte für eine Anfrage. Optionale
// Verbesserung: ohne Voyage-Key oder bei einem Fehler wird einfach null zurückgegeben,
// die Prompts fallen dann automatisch auf das volle Material zurück (kein harter Fehler).
async function tryRetrieve(materials, query) {
  if (!rag.isAvailable(materials)) return null;
  try {
    return await rag.retrieve(materials, query);
  } catch (err) {
    console.error('RAG-Abruf fehlgeschlagen, nutze Volltext-Fallback:', err.message);
    return null;
  }
}

function requireExam(req) {
  const exam = store.getExam(req.params.examId);
  if (!exam) {
    const err = new Error('Klausur nicht gefunden.');
    err.status = 404;
    throw err;
  }
  return exam;
}

function requireTopic(exam, req) {
  const topic = store.getTopic(exam, req.params.topicId);
  if (!topic) {
    const err = new Error('Thema nicht gefunden.');
    err.status = 404;
    throw err;
  }
  return topic;
}

function examSummary(exam) {
  const topics = exam.topics || [];
  const sessions = (exam.plan?.days || []).flatMap((d) => d.sessions || []);
  const done = sessions.filter((s) => s.done).length;
  const mastery = topics.length
    ? Math.round(topics.reduce((a, t) => a + (t.mastery || 0), 0) / topics.length)
    : 0;
  return {
    id: exam.id,
    title: exam.title,
    subject: exam.subject,
    examDate: exam.examDate,
    dailyMinutes: exam.dailyMinutes,
    materialCount: (exam.materials || []).length,
    topicCount: topics.length,
    hasPlan: !!exam.plan,
    progress: sessions.length ? Math.round((done / sessions.length) * 100) : 0,
    mastery,
    daysLeft: Math.ceil((new Date(exam.examDate) - new Date(todayStr())) / 86400000),
  };
}

// Spaced Repetition nach dem SM-2-Algorithmus (SuperMemo): der Wiederholungsabstand
// wächst mit jeder guten Abfrage um den individuellen Leichtigkeitsfaktor (easeFactor)
// des Themas, statt einer festen Intervall-Leiter zu folgen. Bei einer schwachen
// Abfrage (< 60%) wird die Wiederholungsserie zurückgesetzt (Intervall wieder 1 Tag).
function applySM2(topic, pct) {
  const quality = Math.max(0, Math.min(5, Math.round(pct / 20))); // 0-100% -> Qualität 0-5
  let ef = topic.easeFactor ?? 2.5;
  let reps = topic.repetitions ?? 0;

  ef = Math.max(1.3, ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

  let interval;
  if (quality < 3) {
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round((topic.intervalDays || 6) * ef);
  }

  topic.easeFactor = Math.round(ef * 100) / 100;
  topic.repetitions = reps;
  topic.intervalDays = interval;
  topic.nextReview = addDays(todayStr(), interval);
}

// Aktualisiert Beherrschung + nächsten Wiederholungstermin nach einer Abfrage.
function applyQuizResult(exam, topic, score, total, kind) {
  const pct = total ? Math.round((score / total) * 100) : 0;
  topic.mastery = Math.round((topic.mastery || 0) * 0.4 + pct * 0.6);
  topic.quizHistory = topic.quizHistory || [];
  topic.quizHistory.push({ date: todayStr(), score, total, kind });

  applySM2(topic, pct);

  exam.memory = exam.memory || [];
  exam.memory.push({
    date: todayStr(),
    topicId: topic.id,
    summary: `${kind === 'flashcards' ? 'Karteikarten' : 'Quiz'} zu "${topic.name}": ${score}/${total} richtig (${pct}%).${pct < 60 ? ' Thema braucht Wiederholung.' : ` Nächste Wiederholung in ${topic.intervalDays} Tag${topic.intervalDays === 1 ? '' : 'en'}.`}`,
  });
}

// ---------- Status & Einstellungen ----------

app.get('/api/state', (req, res) => {
  const db = store.load();
  res.json({
    hasApiKey: claude.hasKey(),
    hasVoyageKey: voyage.hasKey(),
    hasUntis: untis.hasCredentials(),
    // Nicht-sensible Untis-Felder werden zurückgegeben, damit das Formular
    // vorausgefüllt bleibt (das Passwort selbst nie).
    untisServer: db.settings.untisServer,
    untisSchool: db.settings.untisSchool,
    untisUsername: db.settings.untisUsername,
    model: claude.model(),
    defaultModel: claude.DEFAULT_MODEL,
    exams: db.exams.map(examSummary),
    today: todayStr(),
  });
});

app.post('/api/settings', (req, res) => {
  const db = store.load();
  if (typeof req.body.apiKey === 'string') db.settings.apiKey = req.body.apiKey.trim();
  if (typeof req.body.model === 'string') db.settings.model = req.body.model.trim();
  if (typeof req.body.voyageApiKey === 'string') db.settings.voyageApiKey = req.body.voyageApiKey.trim();
  if (typeof req.body.untisSchool === 'string') db.settings.untisSchool = req.body.untisSchool.trim();
  if (typeof req.body.untisServer === 'string') db.settings.untisServer = req.body.untisServer.trim();
  if (typeof req.body.untisUsername === 'string') db.settings.untisUsername = req.body.untisUsername.trim();
  if (typeof req.body.untisPassword === 'string') db.settings.untisPassword = req.body.untisPassword.trim();
  store.save();
  res.json({
    ok: true,
    hasApiKey: claude.hasKey(),
    hasVoyageKey: voyage.hasKey(),
    hasUntis: untis.hasCredentials(),
    model: claude.model(),
  });
});

// ---------- Klausuren ----------

app.post('/api/exams', (req, res) => {
  const { title, subject, examDate, dailyMinutes, notes } = req.body;
  if (!title || !examDate) {
    return res.status(400).json({ error: 'Titel und Klausurtermin sind erforderlich.' });
  }
  const db = store.load();
  const exam = {
    id: store.uid(),
    title: String(title).trim(),
    subject: String(subject || '').trim(),
    examDate,
    dailyMinutes: Math.max(15, parseInt(dailyMinutes, 10) || 60),
    notes: String(notes || '').trim(),
    createdAt: new Date().toISOString(),
    materials: [],
    topics: [],
    plan: null,
    memory: [],
  };
  db.exams.push(exam);
  store.save();
  res.json({ exam: examSummary(exam) });
});

app.get('/api/exams/:examId', asyncRoute(async (req, res) => {
  const exam = requireExam(req);
  res.json({ exam, summary: examSummary(exam), today: todayStr() });
}));

app.delete('/api/exams/:examId', (req, res) => {
  const db = store.load();
  const idx = db.exams.findIndex((e) => e.id === req.params.examId);
  if (idx < 0) return res.status(404).json({ error: 'Klausur nicht gefunden.' });
  for (const m of db.exams[idx].materials || []) {
    if (m.storedName) fs.rm(path.join(store.UPLOAD_DIR, m.storedName), { force: true }, () => {});
    store.deleteMaterialChunks(m.id);
  }
  db.exams.splice(idx, 1);
  store.save();
  res.json({ ok: true });
});

// ---------- Materialien ----------

// Liest eine hochgeladene Datei aus und baut daraus ein Material-Objekt
// (gemeinsame Logik für Klausur-Materialien und Abi-Trainer-Materialien).
async function extractMaterial(file) {
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const kind = extract.kindOf(name);
  const material = {
    id: store.uid(),
    originalName: name,
    storedName: file.filename,
    kind,
    text: '',
    pending: false,
    addedAt: new Date().toISOString(),
  };
  if (kind === 'image') {
    if (claude.hasKey()) {
      material.text = await claude.ask({
        content: [extract.imageBlock(file.path, name), { type: 'text', text: prompts.imageExtractPrompt() }],
        maxTokens: 4096,
      });
    } else {
      material.pending = true; // wird bei der nächsten KI-Anfrage nachgeholt
      return { material, warning: `${name}: Bild gespeichert – Textextraktion folgt, sobald ein API-Schlüssel hinterlegt ist.` };
    }
  } else if (kind === 'unknown') {
    fs.rm(file.path, { force: true }, () => {});
    return { material: null, warning: `${name}: Dateityp wird nicht unterstützt und wurde übersprungen.` };
  } else {
    material.text = await extract.extractText(file.path, name);
  }
  return { material };
}

app.post('/api/exams/:examId/materials', upload.array('files'), asyncRoute(async (req, res) => {
  const exam = requireExam(req);
  const added = [];
  const warnings = [];

  for (const file of req.files || []) {
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    try {
      const { material, warning } = await extractMaterial(file);
      if (warning) warnings.push(warning);
      if (material) {
        exam.materials.push(material);
        added.push({ id: material.id, originalName: material.originalName, kind: material.kind, pending: material.pending });
      }
    } catch (err) {
      warnings.push(`${name}: ${err.message}`);
      fs.rm(file.path, { force: true }, () => {});
    }
  }

  store.save();
  res.json({ added, warnings });
}));

app.delete('/api/exams/:examId/materials/:materialId', (req, res) => {
  const exam = store.getExam(req.params.examId);
  if (!exam) return res.status(404).json({ error: 'Klausur nicht gefunden.' });
  const idx = (exam.materials || []).findIndex((m) => m.id === req.params.materialId);
  if (idx < 0) return res.status(404).json({ error: 'Material nicht gefunden.' });
  const [m] = exam.materials.splice(idx, 1);
  if (m.storedName) fs.rm(path.join(store.UPLOAD_DIR, m.storedName), { force: true }, () => {});
  store.deleteMaterialChunks(m.id);
  store.save();
  res.json({ ok: true });
});

// Holt ausstehende Bild-Extraktionen nach (z.B. wenn der Schlüssel erst später gesetzt wurde).
async function ensureMaterialsExtracted(exam) {
  for (const m of exam.materials || []) {
    if (m.pending && m.kind === 'image') {
      const filePath = path.join(store.UPLOAD_DIR, m.storedName);
      if (!fs.existsSync(filePath)) { m.pending = false; continue; }
      m.text = await claude.ask({
        content: [extract.imageBlock(filePath, m.originalName), { type: 'text', text: prompts.imageExtractPrompt() }],
        maxTokens: 4096,
      });
      m.pending = false;
    }
  }
}

// ---------- Lernplan ----------

app.post('/api/exams/:examId/plan', asyncRoute(async (req, res) => {
  const exam = requireExam(req);
  await ensureMaterialsExtracted(exam);

  const data = await claude.askJSON(prompts.planPrompt(exam, todayStr()));

  // Bestehende Lernstände (Gedächtnis) beim Neu-Generieren erhalten:
  // Themen mit gleichem Namen behalten Beherrschung, Lektion und Historie.
  const oldByName = new Map((exam.topics || []).map((t) => [t.name.toLowerCase(), t]));
  const keyToId = new Map();

  exam.topics = (data.topics || []).map((t) => {
    const old = oldByName.get(String(t.name).toLowerCase());
    const topic = {
      id: old ? old.id : store.uid(),
      name: t.name,
      description: t.description || '',
      estimatedMinutes: t.estimatedMinutes || 45,
      difficulty: t.difficulty || 'mittel',
      mastery: old?.mastery || 0,
      lesson: old?.lesson || null,
      chat: old?.chat || [],
      quizHistory: old?.quizHistory || [],
      easeFactor: old?.easeFactor ?? 2.5,
      repetitions: old?.repetitions ?? 0,
      intervalDays: old?.intervalDays ?? null,
      nextReview: old?.nextReview || null,
    };
    keyToId.set(t.key, topic.id);
    return topic;
  });

  exam.plan = {
    overview: data.overview || '',
    totalEstimatedHours: data.totalEstimatedHours || null,
    generatedAt: new Date().toISOString(),
    days: (data.days || [])
      .map((d) => ({
        date: d.date,
        sessions: (d.sessions || [])
          .filter((s) => keyToId.has(s.topicKey))
          .map((s) => ({
            topicId: keyToId.get(s.topicKey),
            type: s.type || 'lernen',
            minutes: s.minutes || 30,
            note: s.note || '',
            done: false,
          })),
      }))
      .filter((d) => d.sessions.length)
      .sort((a, b) => a.date.localeCompare(b.date)),
  };

  store.save();
  res.json({ exam });
}));

app.post('/api/exams/:examId/sessions/toggle', (req, res) => {
  const exam = store.getExam(req.params.examId);
  if (!exam || !exam.plan) return res.status(404).json({ error: 'Plan nicht gefunden.' });
  const { date, index } = req.body;
  const day = exam.plan.days.find((d) => d.date === date);
  const session = day?.sessions?.[index];
  if (!session) return res.status(404).json({ error: 'Session nicht gefunden.' });
  session.done = !session.done;
  store.save();
  res.json({ done: session.done });
});

// ---------- Lektion ----------

app.post('/api/exams/:examId/topics/:topicId/lesson', asyncRoute(async (req, res) => {
  const exam = requireExam(req);
  const topic = requireTopic(exam, req);
  await ensureMaterialsExtracted(exam);

  const ragChunks = await tryRetrieve(exam.materials, `${topic.name} ${topic.description || ''}`);
  const content = await claude.ask(prompts.lessonPrompt(exam, topic, ragChunks));
  topic.lesson = { content, createdAt: new Date().toISOString() };
  if (!topic.nextReview) topic.nextReview = addDays(todayStr(), 1);

  exam.memory = exam.memory || [];
  exam.memory.push({
    date: todayStr(),
    topicId: topic.id,
    summary: `Lektion zu "${topic.name}" durchgearbeitet.`,
  });
  store.save();
  res.json({ lesson: topic.lesson });
}));

// ---------- Quiz ----------

const pendingQuizzes = new Map(); // quizId -> { examId, topicId, questions }

app.post('/api/exams/:examId/topics/:topicId/quiz', asyncRoute(async (req, res) => {
  const exam = requireExam(req);
  const topic = requireTopic(exam, req);
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 6, 3), 15);

  const ragChunks = await tryRetrieve(exam.materials, `${topic.name} ${topic.description || ''}`);
  const data = await claude.askJSON(prompts.quizPrompt(exam, topic, { count }, ragChunks));
  const questions = (data.questions || []).filter((q) => q && q.type && q.question);
  if (!questions.length) throw new Error('Quiz konnte nicht erstellt werden. Bitte erneut versuchen.');

  const quizId = store.uid();
  pendingQuizzes.set(quizId, { examId: exam.id, topicId: topic.id, questions });

  // Lösungen nicht an den Client schicken.
  const publicQuestions = questions.map((q) => {
    const { correctIndex, correct, answers, sampleAnswer, explanation, ...rest } = q;
    return { ...rest, blanks: q.type === 'cloze' ? (answers || []).length : undefined };
  });
  res.json({ quizId, questions: publicQuestions });
}));

app.post('/api/exams/:examId/topics/:topicId/quiz/grade', asyncRoute(async (req, res) => {
  const exam = requireExam(req);
  const topic = requireTopic(exam, req);
  const { quizId, answers } = req.body;
  const quiz = pendingQuizzes.get(quizId);
  if (!quiz || quiz.topicId !== topic.id) {
    return res.status(404).json({ error: 'Quiz abgelaufen. Bitte ein neues Quiz starten.' });
  }

  const results = new Array(quiz.questions.length);
  const openItems = [];

  quiz.questions.forEach((q, i) => {
    const a = answers?.[i];
    if (q.type === 'mc') {
      const correct = Number(a) === Number(q.correctIndex);
      results[i] = { correct, correctAnswer: q.options[q.correctIndex], explanation: q.explanation || '' };
    } else if (q.type === 'truefalse') {
      const correct = Boolean(a) === Boolean(q.correct);
      results[i] = { correct, correctAnswer: q.correct ? 'Wahr' : 'Falsch', explanation: q.explanation || '' };
    } else if (q.type === 'cloze') {
      const user = Array.isArray(a) ? a : [];
      const expected = q.answers || [];
      const correct =
        expected.length > 0 &&
        expected.every((sol, j) => String(user[j] || '').trim().toLowerCase() === String(sol).trim().toLowerCase());
      results[i] = { correct, correctAnswer: expected.join(', '), explanation: q.explanation || '' };
    } else if (q.type === 'open') {
      openItems.push({ index: i, question: q.question, sampleAnswer: q.sampleAnswer || '', userAnswer: String(a || '') });
    }
  });

  if (openItems.length) {
    const graded = await claude.askJSON(prompts.gradeOpenPrompt(openItems));
    openItems.forEach((it, j) => {
      const r = graded.results?.[j] || { correct: false, feedback: 'Konnte nicht bewertet werden.' };
      results[it.index] = {
        correct: !!r.correct,
        correctAnswer: quiz.questions[it.index].sampleAnswer || '',
        explanation: r.feedback || '',
      };
    });
  }

  const score = results.filter((r) => r && r.correct).length;
  applyQuizResult(exam, topic, score, quiz.questions.length, 'quiz');
  pendingQuizzes.delete(quizId);
  store.save();

  res.json({ score, total: quiz.questions.length, results, mastery: topic.mastery, nextReview: topic.nextReview });
}));

// ---------- Karteikarten ----------

app.post('/api/exams/:examId/topics/:topicId/flashcards', asyncRoute(async (req, res) => {
  const exam = requireExam(req);
  const topic = requireTopic(exam, req);
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 10, 4), 25);
  const ragChunks = await tryRetrieve(exam.materials, `${topic.name} ${topic.description || ''}`);
  const data = await claude.askJSON(prompts.flashcardsPrompt(exam, topic, { count }, ragChunks));
  const cards = (data.cards || []).filter((c) => c && c.front && c.back);
  if (!cards.length) throw new Error('Karteikarten konnten nicht erstellt werden.');
  res.json({ cards });
}));

app.post('/api/exams/:examId/topics/:topicId/flashcards/result', asyncRoute(async (req, res) => {
  const exam = requireExam(req);
  const topic = requireTopic(exam, req);
  const known = parseInt(req.body.known, 10) || 0;
  const total = parseInt(req.body.total, 10) || 0;
  if (total > 0) {
    applyQuizResult(exam, topic, known, total, 'flashcards');
    store.save();
  }
  res.json({ mastery: topic.mastery, nextReview: topic.nextReview });
}));

// ---------- Chat (Fragen zu Themen) ----------

app.post('/api/exams/:examId/topics/:topicId/chat', asyncRoute(async (req, res) => {
  const exam = requireExam(req);
  const topic = requireTopic(exam, req);
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Leere Nachricht.' });

  topic.chat = topic.chat || [];
  const history = topic.chat.slice(-20).map((m) => ({ role: m.role, content: m.content }));

  const ragChunks = await tryRetrieve(exam.materials, message);
  const reply = await claude.ask({
    system: prompts.chatSystem(exam, topic, ragChunks),
    content: message,
    history,
    maxTokens: 4096,
  });

  topic.chat.push({ role: 'user', content: message, at: new Date().toISOString() });
  topic.chat.push({ role: 'assistant', content: reply, at: new Date().toISOString() });
  store.save();
  res.json({ reply });
}));

// ---------- Abi-Trainer (STARK-Verlag-Stil, BW-Punkteschema) ----------

function requireAbiSubject(req) {
  const name = req.params.subject;
  if (!store.ABI_SUBJECTS.includes(name)) {
    const err = new Error('Unbekanntes Leistungsfach.');
    err.status = 404;
    throw err;
  }
  return name;
}

function abiSubjectSummary(name) {
  const s = store.getAbiSubject(name);
  const history = s.taskHistory || [];
  const last = history[history.length - 1];
  return {
    subject: name,
    materialCount: s.materials.length,
    taskCount: history.length,
    lastScore: last ? { points: last.points, maxPoints: last.maxPoints, date: last.date } : null,
  };
}

const pendingAbiTasks = new Map(); // taskId -> { subject, task, modelSolution, maxPoints }

app.get('/api/abi-trainer', (req, res) => {
  res.json({ subjects: store.ABI_SUBJECTS.map(abiSubjectSummary) });
});

app.get('/api/abi-trainer/:subject', asyncRoute(async (req, res) => {
  const name = requireAbiSubject(req);
  const s = store.getAbiSubject(name);
  res.json({ subject: name, materials: s.materials, taskHistory: s.taskHistory });
}));

app.post('/api/abi-trainer/:subject/materials', upload.array('files'), asyncRoute(async (req, res) => {
  const name = requireAbiSubject(req);
  const s = store.getAbiSubject(name);
  const added = [];
  const warnings = [];

  for (const file of req.files || []) {
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    try {
      const { material, warning } = await extractMaterial(file);
      if (warning) warnings.push(warning);
      if (material) {
        s.materials.push(material);
        added.push({ id: material.id, originalName: material.originalName, kind: material.kind, pending: material.pending });
      }
    } catch (err) {
      warnings.push(`${fileName}: ${err.message}`);
      fs.rm(file.path, { force: true }, () => {});
    }
  }

  store.save();
  res.json({ added, warnings });
}));

app.delete('/api/abi-trainer/:subject/materials/:materialId', (req, res) => {
  const name = req.params.subject;
  if (!store.ABI_SUBJECTS.includes(name)) return res.status(404).json({ error: 'Unbekanntes Leistungsfach.' });
  const s = store.getAbiSubject(name);
  const idx = s.materials.findIndex((m) => m.id === req.params.materialId);
  if (idx < 0) return res.status(404).json({ error: 'Material nicht gefunden.' });
  const [m] = s.materials.splice(idx, 1);
  if (m.storedName) fs.rm(path.join(store.UPLOAD_DIR, m.storedName), { force: true }, () => {});
  store.deleteMaterialChunks(m.id);
  store.save();
  res.json({ ok: true });
});

app.post('/api/abi-trainer/:subject/task', asyncRoute(async (req, res) => {
  const name = requireAbiSubject(req);
  const s = store.getAbiSubject(name);

  const data = await claude.askJSON(prompts.abiTaskPrompt(name, s.materials, s.taskHistory));
  if (!data.task || !data.modelSolution) throw new Error('Aufgabe konnte nicht erstellt werden. Bitte erneut versuchen.');

  const taskId = store.uid();
  pendingAbiTasks.set(taskId, {
    subject: name,
    task: data.task,
    modelSolution: data.modelSolution,
    maxPoints: data.maxPoints || 15,
    taskSummary: data.taskSummary || name,
  });

  res.json({ taskId, task: data.task, maxPoints: data.maxPoints || 15 });
}));

app.post('/api/abi-trainer/:subject/task/:taskId/grade', asyncRoute(async (req, res) => {
  const name = requireAbiSubject(req);
  const pending = pendingAbiTasks.get(req.params.taskId);
  if (!pending || pending.subject !== name) {
    const err = new Error('Aufgabe abgelaufen. Bitte eine neue Aufgabe stellen.');
    err.status = 404;
    throw err;
  }
  const answer = String(req.body.answer || '').trim();

  const graded = await claude.askJSON(prompts.abiGradePrompt(name, pending.task, pending.modelSolution, answer));
  const points = Math.max(0, Math.min(pending.maxPoints, Math.round(graded.points ?? 0)));

  const s = store.getAbiSubject(name);
  s.taskHistory.push({
    date: todayStr(),
    taskSummary: pending.taskSummary,
    points,
    maxPoints: pending.maxPoints,
  });
  store.save();
  pendingAbiTasks.delete(req.params.taskId);

  res.json({ points, maxPoints: pending.maxPoints, feedback: graded.feedback || '', modelSolution: pending.modelSolution });
}));

// ---------- Heute-Ansicht (über alle Klausuren) ----------

app.get('/api/today', (req, res) => {
  const db = store.load();
  const today = todayStr();
  const sessions = [];
  const reviews = [];

  for (const exam of db.exams) {
    const day = exam.plan?.days?.find((d) => d.date === today);
    if (day) {
      day.sessions.forEach((s, index) => {
        const topic = store.getTopic(exam, s.topicId);
        sessions.push({
          examId: exam.id,
          examTitle: exam.title,
          date: today,
          index,
          topicId: s.topicId,
          topicName: topic?.name || '?',
          type: s.type,
          minutes: s.minutes,
          note: s.note,
          done: s.done,
        });
      });
    }
    for (const t of exam.topics || []) {
      if (t.nextReview && t.nextReview <= today) {
        reviews.push({
          examId: exam.id,
          examTitle: exam.title,
          topicId: t.id,
          topicName: t.name,
          mastery: t.mastery || 0,
          due: t.nextReview,
        });
      }
    }
  }

  res.json({ today, sessions, reviews });
});

// ---------- WebUntis (Hausaufgaben) ----------

app.get('/api/untis/homework', asyncRoute(async (req, res) => {
  const homework = await untis.getUpcomingHomework();
  const db = store.load();

  // Ordnet jeder Hausaufgabe (falls möglich) eine passende Klausur zu, damit
  // direkt zu den entsprechenden Themen/Übungsaufgaben in der App verlinkt werden kann.
  const enriched = homework.map((h) => {
    const hs = (h.subject || '').toLowerCase();
    const match = hs ? db.exams.find((e) => {
      const es = (e.subject || '').toLowerCase();
      return es && (es.includes(hs) || hs.includes(es));
    }) : null;
    return { ...h, examId: match?.id || null, examTitle: match?.title || null };
  });

  res.json({ homework: enriched });
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lernassistent läuft auf http://localhost:${PORT}`);
});
