// Alle Prompts des Lernassistenten. Sprache der Ausgabe ist Deutsch.

const MAX_MATERIAL_CHARS = 60000;

function materialsText(exam) {
  const parts = (exam.materials || [])
    .filter((m) => m.text && m.text.trim())
    .map((m) => `### Quelle: ${m.originalName}\n${m.text.trim()}`);
  let combined = parts.join('\n\n');
  if (combined.length > MAX_MATERIAL_CHARS) {
    combined = combined.slice(0, MAX_MATERIAL_CHARS) + '\n\n[... Material gekürzt ...]';
  }
  return combined || '(Keine Materialien vorhanden – nutze dein Fachwissen zum angegebenen Thema.)';
}

function topicMaterial(exam, topic) {
  // Für Lektionen/Quiz: gesamtes Material mitgeben, Claude fokussiert auf das Thema.
  return materialsText(exam);
}

// "Gedächtnis": fasst zusammen, was bereits gelernt wurde und wo Schwächen liegen,
// damit neue Lektionen, Quiz und Chat an Vorwissen anknüpfen können.
function memorySummary(exam, { excludeTopicId } = {}) {
  const lines = [];
  for (const t of exam.topics || []) {
    if (t.id === excludeTopicId) continue;
    const done = [];
    if (t.lesson) done.push('Lektion gelernt');
    if ((t.quizHistory || []).length) {
      const last = t.quizHistory[t.quizHistory.length - 1];
      done.push(`letztes Quiz: ${last.score}/${last.total} Punkte`);
    }
    if (done.length) {
      lines.push(`- ${t.name} (Beherrschung ${t.mastery ?? 0}%): ${done.join(', ')}`);
    }
  }
  const mem = (exam.memory || []).slice(-12);
  const notes = mem.map((m) => `- [${m.date}] ${m.summary}`);
  let out = '';
  if (lines.length) out += `Bereits gelernte Themen:\n${lines.join('\n')}\n`;
  if (notes.length) out += `\nLernprotokoll (Auszug):\n${notes.join('\n')}`;
  return out || '(Noch nichts gelernt – dies ist der Anfang.)';
}

function planPrompt(exam, today) {
  return {
    system:
      'Du bist ein erfahrener Lerncoach und Didaktik-Experte. Du erstellst realistische, motivierende Lernpläne. Du antwortest ausschließlich mit gültigem JSON, ohne Markdown-Codezäune und ohne Text davor oder danach. Alle Texte im JSON sind auf Deutsch.',
    content: `Erstelle einen Lernplan für folgende Klausur.

Klausur: ${exam.title}
Fach: ${exam.subject || 'nicht angegeben'}
Klausurtermin: ${exam.examDate}
Heutiges Datum: ${today}
Verfügbare Lernzeit pro Tag: ca. ${exam.dailyMinutes} Minuten
${exam.notes ? `Hinweise der Lernenden: ${exam.notes}` : ''}

Lernmaterialien:
${materialsText(exam)}

Aufgabe:
1. Zerlege den Stoff in 4–12 klar abgegrenzte Themen (abhängig vom Umfang des Materials).
2. Verteile die Themen auf die Tage von heute bis zum Tag vor der Klausur. Jeder Lerntag hat höchstens ${exam.dailyMinutes} Minuten. Nicht jeder Tag muss belegt sein, aber der Plan soll den Stoff vollständig abdecken.
3. Baue Wiederholungseinheiten ein (Spaced Repetition): Themen werden einige Tage nach dem Erstlernen kurz wiederholt bzw. abgefragt.
4. Plane am letzten Tag (oder den letzten beiden Tagen) vor der Klausur eine Generalwiederholung.
5. Session-Typen: "lernen" (Neues erarbeiten), "wiederholen" (Auffrischen), "abfragen" (aktives Quiz).

Antworte mit genau diesem JSON-Schema:
{
  "overview": "2-4 Sätze: Zusammenfassung der Strategie des Plans",
  "totalEstimatedHours": 12.5,
  "topics": [
    {"key": "t1", "name": "Themenname", "description": "1-2 Sätze, was das Thema umfasst", "estimatedMinutes": 60, "difficulty": "leicht|mittel|schwer"}
  ],
  "days": [
    {"date": "YYYY-MM-DD", "sessions": [{"topicKey": "t1", "type": "lernen", "minutes": 45, "note": "kurzer Hinweis, was genau zu tun ist"}]}
  ]
}`,
    maxTokens: 8192,
  };
}

function lessonPrompt(exam, topic) {
  return {
    system:
      'Du bist ein hervorragender Tutor. Du erklärst Stoff klar, strukturiert und einprägsam auf Deutsch, mit Beispielen, Merksätzen und Eselsbrücken. Du nutzt Markdown (Überschriften, Listen, **fett** für Schlüsselbegriffe).',
    content: `Erstelle eine vollständige Lerneinheit zum Thema "${topic.name}" für die Klausur "${exam.title}" (${exam.subject || ''}).

Themenbeschreibung: ${topic.description || '-'}
Geplante Dauer: ca. ${topic.estimatedMinutes || 45} Minuten

Was bereits gelernt wurde (knüpfe daran an, wo es passt):
${memorySummary(exam, { excludeTopicId: topic.id })}

Lernmaterialien (nutze sie als primäre Quelle, fokussiere auf das genannte Thema):
${topicMaterial(exam, topic)}

Aufbau der Lerneinheit:
1. **Überblick & Lernziele** (was kann ich danach?)
2. **Der Stoff** – klar strukturiert erklärt, mit Beispielen und ggf. Formeln/Definitionen
3. **Merkkasten** – die 3–7 wichtigsten Punkte kompakt
4. **Typische Fehler & Prüfungsfallen**
5. **Mini-Check** – 3 kurze Verständnisfragen zum Selbsttest (mit Antworten am Ende, eingeklappt als "Antworten"-Abschnitt)`,
    maxTokens: 8192,
  };
}

function quizPrompt(exam, topic, { count = 6 } = {}) {
  return {
    system:
      'Du bist ein Prüfungsexperte und erstellst faire, lehrreiche Quizfragen auf Deutsch. Du antwortest ausschließlich mit gültigem JSON ohne Markdown-Codezäune.',
    content: `Erstelle ein abwechslungsreiches Quiz mit ${count} Fragen zum Thema "${topic.name}" für die Klausur "${exam.title}".

Themenbeschreibung: ${topic.description || '-'}
Bisheriger Lernstand: Beherrschung ${topic.mastery ?? 0}%. ${
      (topic.quizHistory || []).length
        ? 'Frühere Quizfehler bei diesem Thema stärker berücksichtigen.'
        : 'Erstes Quiz zu diesem Thema.'
    }

Lernmaterialien (primäre Quelle, fokussiere auf das Thema):
${topicMaterial(exam, topic)}

Mische die Fragetypen: "mc" (Multiple Choice, 4 Optionen), "truefalse" (Wahr/Falsch), "open" (offene Frage, 1-3 Sätze Antwort), "cloze" (Lückentext mit ___ als Lücke).

Antworte mit genau diesem JSON-Schema:
{
  "questions": [
    {"type": "mc", "question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "warum"},
    {"type": "truefalse", "question": "Aussage ...", "correct": true, "explanation": "warum"},
    {"type": "open", "question": "...", "sampleAnswer": "Musterantwort"},
    {"type": "cloze", "question": "Satz mit ___ und ggf. weiterer ___.", "answers": ["Wort1", "Wort2"], "explanation": "kurz"}
  ]
}`,
    maxTokens: 6000,
  };
}

function gradeOpenPrompt(items) {
  const list = items
    .map(
      (it, i) =>
        `${i + 1}. Frage: ${it.question}\n   Musterantwort: ${it.sampleAnswer}\n   Antwort der Lernenden: ${it.userAnswer || '(keine Antwort)'}`
    )
    .join('\n\n');
  return {
    system:
      'Du bewertest Quizantworten fair und wohlwollend auf Deutsch. Sinngemäß richtige Antworten zählen als richtig. Du antwortest ausschließlich mit gültigem JSON ohne Markdown-Codezäune.',
    content: `Bewerte die folgenden offenen Antworten:

${list}

Antworte mit genau diesem JSON-Schema (gleiche Reihenfolge wie oben):
{"results": [{"correct": true, "feedback": "1-2 Sätze konstruktives Feedback"}]}`,
    maxTokens: 2048,
  };
}

function flashcardsPrompt(exam, topic, { count = 10 } = {}) {
  return {
    system:
      'Du erstellst prägnante Karteikarten auf Deutsch. Vorderseite: kurze Frage/Begriff. Rückseite: knappe, korrekte Antwort. Du antwortest ausschließlich mit gültigem JSON ohne Markdown-Codezäune.',
    content: `Erstelle ${count} Karteikarten zum Thema "${topic.name}" für die Klausur "${exam.title}".

Themenbeschreibung: ${topic.description || '-'}

Lernmaterialien (primäre Quelle):
${topicMaterial(exam, topic)}

Antworte mit genau diesem JSON-Schema:
{"cards": [{"front": "Frage/Begriff", "back": "Antwort"}]}`,
    maxTokens: 4096,
  };
}

function chatSystem(exam, topic) {
  return `Du bist ein geduldiger, freundlicher Tutor für die Klausur "${exam.title}" (${exam.subject || ''}), aktuelles Thema: "${topic.name}".
Antworte auf Deutsch, klar und auf den Punkt. Nutze Markdown. Erkläre Schritt für Schritt, gib Beispiele, und stelle bei Bedarf eine Rückfrage, um Verständnis zu prüfen.

Was die Lernende bereits gelernt hat (knüpfe daran an):
${memorySummary(exam)}

Lernmaterialien zur Klausur (primäre Quelle):
${topicMaterial(exam, topic)}`;
}

function imageExtractPrompt() {
  return 'Extrahiere den kompletten Lerninhalt aus diesem Bild (z.B. Notizen, Folie, Tafelbild, Buchseite). Gib den Text strukturiert und vollständig auf Deutsch wieder. Beschreibe Diagramme/Abbildungen kurz in eckigen Klammern. Gib nur den extrahierten Inhalt zurück, keine Einleitung.';
}

module.exports = {
  planPrompt,
  lessonPrompt,
  quizPrompt,
  gradeOpenPrompt,
  flashcardsPrompt,
  chatSystem,
  imageExtractPrompt,
  memorySummary,
};
