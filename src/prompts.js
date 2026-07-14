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

// ---------- Abi-Trainer (STARK-Verlag-Stil, BW-Punkteschema 0-15) ----------

const ABI_SUBJECT_GUIDANCE = {
  Mathe: 'Eine anspruchsvolle Analysis-, Analytische-Geometrie- oder Stochastik-Aufgabe im Stil des baden-württembergischen Mathematik-Abiturs (Leistungsfach), mit mehreren Teilaufgaben (a, b, c, …), die einen vollständigen Rechenweg erfordern.',
  Englisch: 'Eine Textanalyse- oder Textproduktionsaufgabe im Stil des baden-württembergischen Englisch-Abiturs (Leistungsfach): ein kurzer Ausgangstext (falls kein passendes Material hochgeladen wurde, einen sinnvollen kurzen Text selbst verfassen) plus 1-2 Teilaufgaben zu comprehension, analysis und comment/creative writing.',
  Sport: 'Eine Sporttheorie-Aufgabe im Stil des baden-württembergischen Sport-Abiturs (Leistungsfach, schriftlicher Teil): Trainingslehre, Bewegungslehre, Anatomie/Physiologie oder Sportbiologie, mit mehreren Teilaufgaben, die Fachwissen und Transferleistung verlangen (kein praktisch-motorischer Teil, da rein schriftlich bearbeitet).',
};

function abiMaterialsText(materials) {
  const parts = (materials || [])
    .filter((m) => m.text && m.text.trim())
    .map((m) => `### Quelle: ${m.originalName}\n${m.text.trim()}`);
  let combined = parts.join('\n\n');
  if (combined.length > MAX_MATERIAL_CHARS) {
    combined = combined.slice(0, MAX_MATERIAL_CHARS) + '\n\n[... Material gekürzt ...]';
  }
  return combined || '(Keine hochgeladenen Altklausuren – orientiere dich am offiziellen baden-württembergischen Bildungsplan und typischen Abiturformaten.)';
}

function abiTaskPrompt(subject, materials, history) {
  const recent = (history || []).slice(-5).map((h) => `- ${h.date}: ${h.points}/${h.maxPoints} Punkte – "${h.taskSummary}"`).join('\n');

  return {
    system:
      'Du bist Fachlehrer:in und Abiturkorrektor:in in Baden-Württemberg. Du erstellst realistische Abiturprüfungsaufgaben auf Leistungsfach-Niveau samt Musterlösung. Du antwortest ausschließlich mit gültigem JSON, ohne Markdown-Codezäune und ohne Text davor oder danach. Alle Texte im JSON sind auf Deutsch (englische Aufgabentexte im Fach Englisch bleiben auf Englisch).',
    content: `Erstelle GENAU EINE Abiturprüfungsaufgabe für das Leistungsfach ${subject} (Baden-Württemberg).

${ABI_SUBJECT_GUIDANCE[subject]}

Hochgeladene Altklausuren/Materialien als Stil- und Themenvorlage:
${abiMaterialsText(materials)}

${recent ? `Bisherige Trainingshistorie (variiere Thema/Schwerpunkt gegenüber diesen letzten Aufgaben):\n${recent}` : 'Dies ist die erste Trainingsaufgabe.'}

Die Aufgabe wird mit maximal 15 Punkten (BW-Punkteschema) bewertet. Erstelle außerdem eine Musterlösung, die exakt zeigt, wie eine Antwort auf 13-15 Punkte-Niveau aussieht (vollständig, präzise, mit allen erwarteten Lösungsschritten bzw. Bewertungskriterien).

Antworte mit genau diesem JSON-Schema:
{
  "taskSummary": "3-6 Wörter Kurzbezeichnung des Themas, z.B. 'Extremwertaufgabe Analysis'",
  "task": "Der vollständige Aufgabentext inkl. aller Teilaufgaben, ggf. mit Materialangabe/Text bei Englisch",
  "modelSolution": "Die vollständige Musterlösung auf 13-15 Punkte-Niveau",
  "maxPoints": 15
}`,
    maxTokens: 8192,
  };
}

function abiGradePrompt(subject, task, modelSolution, userAnswer) {
  return {
    system:
      'Du bist Abiturkorrektor:in in Baden-Württemberg und bewertest nach dem BW-Punkteschema (0-15 Punkte) fair, aber nach denselben Maßstäben wie im echten Abitur. Du antwortest ausschließlich mit gültigem JSON ohne Markdown-Codezäune.',
    content: `Bewerte die folgende Schülerantwort auf die Abituraufgabe (Fach: ${subject}).

Aufgabe:
${task}

Musterlösung (13-15 Punkte-Niveau):
${modelSolution}

Antwort der Lernenden:
${userAnswer || '(keine Antwort abgegeben)'}

Vergib eine Punktzahl von 0 bis 15 gemäß BW-Punkteschema, orientiert an fachlicher Richtigkeit, Vollständigkeit und Darstellungsqualität im Vergleich zur Musterlösung. Gib konstruktives, konkretes Feedback (was war gut, was hat gefehlt).

Antworte mit genau diesem JSON-Schema:
{"points": 11, "maxPoints": 15, "feedback": "3-6 Sätze konstruktives, konkretes Feedback"}`,
    maxTokens: 2048,
  };
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
  abiTaskPrompt,
  abiGradePrompt,
};
