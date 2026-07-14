const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ABI_SUBJECTS = ['Mathe', 'Englisch', 'Sport'];

function defaultDb() {
  return {
    settings: { apiKey: '', model: '' },
    exams: [],
    abiTrainer: {},
  };
}

let db = null;

function load() {
  ensureDirs();
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    db = defaultDb();
  }
  if (!db.settings) db.settings = { apiKey: '', model: '' };
  if (!Array.isArray(db.exams)) db.exams = [];
  if (!db.abiTrainer) db.abiTrainer = {};
  return db;
}

// Legt den Bereich für ein Leistungsfach bei Bedarf an (Mathe/Englisch/Sport).
function getAbiSubject(name) {
  const d = load();
  if (!d.abiTrainer[name]) {
    d.abiTrainer[name] = { materials: [], taskHistory: [] };
  }
  return d.abiTrainer[name];
}

function save() {
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getExam(id) {
  return load().exams.find((e) => e.id === id) || null;
}

function getTopic(exam, topicId) {
  return (exam.topics || []).find((t) => t.id === topicId) || null;
}

module.exports = { load, save, uid, getExam, getTopic, getAbiSubject, ABI_SUBJECTS, UPLOAD_DIR };
