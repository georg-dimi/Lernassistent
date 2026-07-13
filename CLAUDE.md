# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies
npm start           # run the server (http://localhost:3000)
npm run dev          # run with node --watch (auto-restart on file changes)
```

There is no test suite, linter, or build step configured in this repo.

On first run, an Anthropic API key must be set — either via the app's "Einstellungen" (Settings) page, or via `ANTHROPIC_API_KEY` in a `.env` file (copy `.env.example`). Without a key, the server and UI still work, but any AI-backed action (plan/lesson/quiz/flashcard generation, chat, image text extraction) fails with a clear error.

## Architecture

Backend: Node.js + Express (`server.js`), single-process, no build step. Frontend: a vanilla-JS single-page app in `public/` (no framework, no bundler) served as static files by the same Express app.

**Backend modules (`src/`):**
- `store.js` — the entire database is one JSON file, `data/db.json`, loaded into memory on first access and rewritten (via a temp-file + rename) on every `save()`. There is no schema migration system; `load()` just patches in missing top-level keys (`settings`, `exams`). Uploaded files live in `data/uploads/`. Both `data/` and `.env` are gitignored — nothing user-specific is committed.
- `claude.js` — thin wrapper around `@anthropic-ai/sdk`. `ask()` sends a message (text or content blocks, e.g. for vision) and returns concatenated text blocks. `askJSON()` calls `ask()` and parses the reply as JSON, stripping markdown code fences; if parsing fails it does one repair round-trip asking Claude to reformat its own output as valid JSON. API key resolution order: stored setting → `ANTHROPIC_API_KEY` env var.
- `extract.js` — classifies uploaded files by extension (`image` / `office` / `text` / `unknown`) and extracts text via `officeparser` (PDF/DOCX/PPTX/XLSX/ODT/etc.) or plain read for text files. Images are not text-extracted here; `imageBlock()` just base64-encodes them for Claude Vision to read directly in a prompt.
- `prompts.js` — every prompt sent to Claude lives here, not inline in `server.js`. All prompts instruct Claude to respond in German and, for structured data (plan/quiz/flashcards/grading), in JSON matching an exact schema given in the prompt. `memorySummary()` builds a recap of what's already been learned (per-topic mastery, quiz history, a rolling log in `exam.memory`) and is threaded into lesson/quiz/chat prompts so they build on prior progress instead of repeating material.

**Domain model:** an *exam* (`Klausur`) has `materials` (uploaded files with extracted text), `topics` (each with a `mastery` score, an optional generated `lesson`, `quizHistory`, and spaced-repetition state `reviewLevel`/`nextReview`), and a `plan` (a list of `days`, each with `sessions` referencing a topic by id, typed `lernen`/`wiederholen`/`abfragen`).

- Regenerating a plan (`POST /api/exams/:id/plan`) re-runs the planning prompt but matches new topics back to existing ones **by lowercased name** to preserve mastery/lesson/history — topic identity is name-based, not stable across a rename.
- Spaced repetition uses a fixed interval ladder, `REVIEW_INTERVALS = [1, 3, 7, 16]` days, advanced on ≥60% quiz/flashcard score and reset to 0 otherwise (`applyQuizResult` in `server.js`).
- Quiz questions are generated then held server-side in an in-memory `Map` (`pendingQuizzes`, not persisted to `db.json`) keyed by a one-time `quizId`, so answers/correct-answers are never sent to the client until grading — restarting the server invalidates any quiz in progress.
- Open-ended quiz questions are graded by a separate Claude call (`gradeOpenPrompt`) rather than exact-match, since answers are free text.

**Frontend (`public/app.js`):** hash-based router (`route()`, driven by `hashchange`), routes like `#/`, `#/neu`, `#/klausur/:id`, `#/klausur/:id/thema/:topicId/:tab`. Each route has a `render*` function that builds an HTML string, injects it into `#view`, then wires up event listeners. All server communication goes through the `api()` helper (thin `fetch` wrapper that throws on non-OK responses). Includes a small hand-rolled Markdown-to-HTML renderer (`md`/`inlineMd`) used to display AI-generated lesson content — headings, lists, tables, code fences, blockquotes, bold/italic/inline-code/links, no external dependency.

**Everything user-facing (UI strings and all AI prompts/output) is in German** — keep this consistent when adding features.
