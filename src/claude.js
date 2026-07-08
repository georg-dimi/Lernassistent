const Anthropic = require('@anthropic-ai/sdk');
const store = require('./store');

const DEFAULT_MODEL = 'claude-sonnet-5';

function apiKey() {
  return store.load().settings.apiKey || process.env.ANTHROPIC_API_KEY || '';
}

function model() {
  return store.load().settings.model || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
}

function hasKey() {
  return !!apiKey();
}

function client() {
  const key = apiKey();
  if (!key) {
    const err = new Error(
      'Kein Anthropic-API-Schlüssel hinterlegt. Bitte unter "Einstellungen" eintragen oder ANTHROPIC_API_KEY setzen.'
    );
    err.status = 400;
    throw err;
  }
  return new Anthropic({ apiKey: key });
}

// content: String oder Array von Content-Blöcken (z.B. mit Bildern)
async function ask({ system, content, history = [], maxTokens = 4096 }) {
  const messages = [...history, { role: 'user', content }];
  const res = await client().messages.create({
    model: model(),
    max_tokens: maxTokens,
    system,
    messages,
  });
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// Fragt Claude nach JSON und parst die Antwort robust (entfernt Codezäune etc.).
async function askJSON(opts) {
  let text = await ask(opts);
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Ein Reparaturversuch: Claude bitten, gültiges JSON daraus zu machen.
    const repaired = await ask({
      system: 'Du gibst ausschließlich gültiges JSON zurück, ohne Markdown und ohne Erklärungen.',
      content: `Wandle die folgende Ausgabe in gültiges JSON um (Inhalt unverändert lassen):\n\n${text}`,
      maxTokens: opts.maxTokens || 4096,
    });
    let r = repaired.trim();
    const f2 = r.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (f2) r = f2[1].trim();
    return JSON.parse(r);
  }
}

module.exports = { ask, askJSON, hasKey, model, DEFAULT_MODEL };
