// Dünner Wrapper um das inoffizielle "webuntis"-npm-Paket. Liest Hausaufgaben
// aus WebUntis aus und bildet sie auf ein einfaches Format ab. Nicht offiziell
// von Untis unterstützt – kann bei Änderungen an deren Server brechen.

const { WebUntis } = require('webuntis');
const store = require('./store');

function credentials() {
  const s = store.load().settings;
  return {
    school: s.untisSchool || '',
    server: s.untisServer || '',
    username: s.untisUsername || '',
    password: s.untisPassword || '',
  };
}

function hasCredentials() {
  const c = credentials();
  return !!(c.school && c.server && c.username && c.password);
}

// Untis liefert Datumsangaben als Zahl im Format YYYYMMDD.
function untisDateToIso(untisDate) {
  const s = String(untisDate);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// Holt fällige Hausaufgaben für die nächsten `days` Tage (Standard: heute + 6 Tage).
async function getUpcomingHomework(days = 7) {
  const c = credentials();
  if (!hasCredentials()) {
    const err = new Error('WebUntis ist nicht verbunden. Bitte Zugangsdaten in den Einstellungen eintragen.');
    err.status = 400;
    throw err;
  }

  const untis = new WebUntis(c.school, c.username, c.password, c.server);
  await untis.login();
  try {
    const rangeStart = new Date();
    const rangeEnd = new Date();
    rangeEnd.setDate(rangeEnd.getDate() + days);

    const result = await untis.getHomeWorksFor(rangeStart, rangeEnd);
    const homeworks = Array.isArray(result?.homeworks) ? result.homeworks : [];
    // Manche Untis-Server liefern zusätzlich "lessons" zur Fach-Zuordnung mit.
    const lessonsById = new Map((result?.lessons || []).map((l) => [l.id, l]));

    return homeworks
      .filter((h) => !h.completed)
      .map((h) => {
        const lesson = lessonsById.get(h.lessonId);
        return {
          id: h.id,
          text: h.text || '',
          remark: h.remark || '',
          subject: lesson?.subject || lesson?.subjectName || '',
          dueDate: untisDateToIso(h.dueDate),
        };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  } finally {
    await untis.logout().catch(() => {});
  }
}

module.exports = { hasCredentials, getUpcomingHomework };
