# 📚 Lernassistent

Ein vollautomatisierter Lernassistent als Web-App: Klausur ankündigen, Unterlagen hochladen, und die KI (Claude) erstellt automatisch einen Lernplan, bringt dir den Stoff bei, fragt ihn ab und beantwortet deine Fragen – mit eingebautem Gedächtnis für Wiederholungen.

## Funktionen

- **📝 Klausur ankündigen** – Titel, Fach, Termin und tägliche Lernzeit festlegen
- **📎 Materialien hochladen** – Fotos (JPG/PNG), PDF, Word (.docx), PowerPoint (.pptx), Excel, Textdateien u.v.m. Der Inhalt wird automatisch ausgelesen (Fotos per Claude Vision).
- **🗓️ Automatischer Lernplan** – die KI zerlegt den Stoff in Themen und verteilt sie auf die Tage bis zur Klausur, inkl. Dauer pro Einheit, Wiederholungen (Spaced Repetition) und Generalprobe vor der Klausur
- **📖 Lektionen** – strukturierte Lerneinheiten mit Beispielen, Merkkasten, Prüfungsfallen und Mini-Selbsttest
- **✍️ Abfragen in verschiedenen Formen** – Multiple Choice, Wahr/Falsch, offene Fragen (KI-bewertet mit Feedback) und Lückentexte
- **🃏 Karteikarten** – klassisches Karteikarten-Lernen mit Selbstbewertung
- **💬 Fragen stellen** – Chat zu jedem Thema; der Tutor kennt deine Unterlagen und deinen Lernstand
- **🧠 Gedächtnis** – der Assistent merkt sich, was du gelernt hast und wie gut. Schwache Themen kommen früher wieder dran, neue Lektionen und der Chat knüpfen an dein Vorwissen an. Fällige Wiederholungen erscheinen auf der Startseite.
- **📊 Fortschritt** – Plan-Fortschritt und Beherrschungsgrad pro Thema und Klausur auf einen Blick

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.

```bash
npm install
npm start
```

Dann im Browser öffnen: **http://localhost:3000**

Beim ersten Start unter **⚙️ Einstellungen** einen Anthropic-API-Schlüssel eintragen
(zu bekommen unter [console.anthropic.com](https://console.anthropic.com/)).
Alternativ per Umgebungsvariable:

```bash
cp .env.example .env   # und ANTHROPIC_API_KEY eintragen
```

## Bedienung

1. **➕ Neue Klausur** anlegen (Titel, Fach, Termin, Lernzeit pro Tag)
2. **Materialien hochladen** – einfach in die Upload-Fläche ziehen
3. **✨ Lernplan erstellen** klicken
4. Täglich auf der Startseite („Heute") die geplanten Einheiten abarbeiten:
   - **Lernen**: Lektion lesen
   - **Abfragen**: Quiz oder Karteikarten
   - **Fragen stellen**: Chat mit dem Tutor
5. Fällige **Wiederholungen** erscheinen automatisch auf der Startseite

## Technik

- **Backend**: Node.js + Express, Claude API (`@anthropic-ai/sdk`), Standardmodell `claude-sonnet-5`
- **Dateiauswertung**: `officeparser` (PDF, DOCX, PPTX, XLSX, ODT …), Fotos via Claude Vision
- **Frontend**: Vanilla JS Single-Page-App, kein Build-Schritt nötig
- **Speicherung**: lokal in `data/db.json` (inkl. API-Schlüssel) und `data/uploads/` – nichts verlässt deinen Rechner außer den API-Aufrufen an Anthropic

## Projektstruktur

```
server.js          Express-Server mit allen API-Routen
src/store.js       JSON-Datenspeicher (data/db.json)
src/extract.js     Textextraktion aus Dateien
src/claude.js      Claude-API-Anbindung (Text + JSON + Vision)
src/prompts.js     Alle Prompts (Plan, Lektion, Quiz, Karten, Chat, Gedächtnis)
public/            Web-Oberfläche (index.html, styles.css, app.js)
```
