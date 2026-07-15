// Einfaches RAG-System: Materialien werden in Abschnitte zerlegt, per Voyage AI
// eingebettet und bei Bedarf per Kosinus-Ähnlichkeit durchsucht. Bei dieser
// Nutzergröße (eine Person, wenige Dutzend Dokumente) reicht ein Brute-Force-
// Vergleich in JavaScript völlig aus – keine externe Vektordatenbank nötig.

const store = require('./store');
const voyage = require('./voyage');

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const TOP_K = 6;

// Zerlegt Text in überlappende Abschnitte, möglichst an Absatzgrenzen.
function chunkText(text) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
  };

  for (const p of paragraphs) {
    let piece = p;
    if (current && (current.length + piece.length + 2) > CHUNK_SIZE) {
      flush();
      current = current.slice(-CHUNK_OVERLAP);
    }
    current += (current ? '\n\n' : '') + piece;
    // Sehr lange Einzelabsätze zusätzlich hart aufteilen.
    while (current.length > CHUNK_SIZE * 1.5) {
      chunks.push(current.slice(0, CHUNK_SIZE).trim());
      current = current.slice(CHUNK_SIZE - CHUNK_OVERLAP);
    }
  }
  flush();
  return chunks;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Sorgt dafür, dass alle Materialien mit Text embedded sind (lazy, pro Material gecacht).
async function ensureEmbedded(materials) {
  for (const m of materials) {
    if (!m.text || !m.text.trim()) continue;
    if (store.getMaterialChunks(m.id)) continue;
    const chunks = chunkText(m.text);
    if (!chunks.length) continue;
    const vectors = await voyage.embed(chunks, 'document');
    store.setMaterialChunks(m.id, chunks.map((text, i) => ({ text, vector: vectors[i] })));
  }
}

// Liefert die Top-K relevantesten Abschnitte für eine Anfrage, je mit Quellenangabe.
async function retrieve(materials, query, { topK = TOP_K } = {}) {
  await ensureEmbedded(materials);
  const [queryVector] = await voyage.embed([query], 'query');

  const scored = [];
  for (const m of materials) {
    const chunks = store.getMaterialChunks(m.id);
    if (!chunks) continue;
    for (const c of chunks) {
      scored.push({ source: m.originalName, text: c.text, score: cosineSim(queryVector, c.vector) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// RAG ist nur nutzbar, wenn ein Voyage-Key hinterlegt ist und es Materialien mit Text gibt.
function isAvailable(materials) {
  return voyage.hasKey() && (materials || []).some((m) => m.text && m.text.trim());
}

module.exports = { chunkText, retrieve, isAvailable };
