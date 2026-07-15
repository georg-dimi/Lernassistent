const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
// Embeddings leben in einer eigenen Datei statt in db.json: sie können pro
// Material mehrere hundert KB groß werden und würden sonst bei jedem
// db.save() (z.B. eine Session abhaken) unnötig mitgeschrieben.
const EMBED_FILE = path.join(DATA_DIR, 'embeddings.json');

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ABI_SUBJECTS = ['Mathe', 'Englisch', 'Sport'];

function defaultDb() {
  return {
    settings: { apiKey: '', model: '', voyageApiKey: '' },
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
  if (!db.settings) db.settings = { apiKey: '', model: '', voyageApiKey: '' };
  if (db.settings.voyageApiKey === undefined) db.settings.voyageApiKey = '';
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

let embeddings = null;

function loadEmbeddings() {
  ensureDirs();
  if (embeddings) return embeddings;
  try {
    embeddings = JSON.parse(fs.readFileSync(EMBED_FILE, 'utf8'));
  } catch {
    embeddings = {};
  }
  return embeddings;
}

function saveEmbeddings() {
  ensureDirs();
  const tmp = EMBED_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(embeddings));
  fs.renameSync(tmp, EMBED_FILE);
}

// chunks: [{ text, vector }, ...] – ersetzt evtl. vorhandene Chunks des Materials.
function setMaterialChunks(materialId, chunks) {
  loadEmbeddings()[materialId] = chunks;
  saveEmbeddings();
}

function getMaterialChunks(materialId) {
  return loadEmbeddings()[materialId] || null;
}

function deleteMaterialChunks(materialId) {
  delete loadEmbeddings()[materialId];
  saveEmbeddings();
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

module.exports = {
  load, save, uid, getExam, getTopic, getAbiSubject, ABI_SUBJECTS, UPLOAD_DIR,
  setMaterialChunks, getMaterialChunks, deleteMaterialChunks,
};
