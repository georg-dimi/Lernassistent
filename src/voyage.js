// Dünner Wrapper um die Voyage-AI-Embeddings-API (HTTP, kein offizielles Node-SDK
// nötig – Node 22 hat fetch() eingebaut). Wird für das RAG-System genutzt:
// Anthropic bietet selbst keine Embeddings-API an, Voyage AI ist der von
// Anthropic empfohlene Partner dafür.

const store = require('./store');

const MODEL = 'voyage-4';
const API_URL = 'https://api.voyageai.com/v1/embeddings';

function apiKey() {
  return store.load().settings.voyageApiKey || process.env.VOYAGE_API_KEY || '';
}

function hasKey() {
  return !!apiKey();
}

// texts: string[], inputType: 'document' | 'query'
// Gibt ein Array von Embedding-Vektoren (number[]） in derselben Reihenfolge zurück.
async function embed(texts, inputType) {
  const key = apiKey();
  if (!key) {
    const err = new Error(
      'Kein Voyage-AI-API-Schlüssel hinterlegt. Bitte unter "Einstellungen" eintragen, damit die Wissenssuche (RAG) genutzt werden kann.'
    );
    err.status = 400;
    throw err;
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage-API-Fehler (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

module.exports = { embed, hasKey, MODEL };
