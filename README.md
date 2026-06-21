# Drift Dock prototype

Drift Dock is a focus assistant built around three ideas: pause before leaving a focus session, leave a useful return anchor, and receive practical support when returning. The Voice-to-Focus Plan adds an optional spoken setup flow without removing the original manual form.

## Features

- Manual task, session goal, and duration setup
- Optional 90-second voice recording with clear recording and processing states
- Backend-only OpenAI speech transcription and strict structured focus-plan extraction
- Editable confirmation step with transcript and detected context
- Dynamic focus durations extracted from speech
- Existing focus timer, pause-before-exit, return anchor, return support, and session report
- Explicit development mock mode for testing without an API key
- In-memory, future-ready session record; no accounts, history, or database

## Architecture

The browser uses HTML, CSS, vanilla JavaScript, `MediaRecorder`, and `getUserMedia`. Express serves the static frontend and accepts multipart audio through Multer at `POST /api/voice/focus-plan`. The server sends temporary audio to OpenAI transcription, then uses Structured Outputs with a Zod schema to create the focus plan. Temporary audio is deleted in a `finally` block.

```text
public/                 Static client
  index.html
  styles.css
  app.js
server/
  server.js             Express setup and static hosting
  routes/voice.js       Upload validation, orchestration, safe errors
  services/             Transcription, extraction, and explicit mock logic
  schemas/              Strict focus-plan schema
test/api.test.js        API and cleanup integration tests
uploads/.gitkeep        Temporary upload directory (contents ignored)
```

## Install and run

Requires Node.js 20 or newer.

```bash
npm install
copy .env.example .env
npm start
```

Open `http://localhost:3000`. For development with restart-on-change, use `npm run dev`.

## Environment variables

- `PORT`: local HTTP port; defaults to `3000`
- `OPENAI_API_KEY`: server-only API key; required unless mock mode is enabled
- `OPENAI_TRANSCRIPTION_MODEL`: defaults to `gpt-4o-mini-transcribe`
- `OPENAI_FOCUS_PLAN_MODEL`: defaults to `gpt-4.1-mini`
- `VOICE_FOCUS_MOCK_MODE`: set to `true` for clearly labelled local mock behavior
- `MAX_AUDIO_SIZE_MB`: upload limit; defaults to `20`

Never place a real API key in `.env.example`, frontend files, commits, or screenshots. `.env` is ignored by Git.

## Mock mode and testing voice input

Set `VOICE_FOCUS_MOCK_MODE=true`, restart the server, and use the visible **Mock transcript (development only)** control. Mock mode is labelled in the UI and the API response; it never silently imitates OpenAI. You can also record audio in mock mode, but the server intentionally substitutes a mock transcript.

For real voice testing, set `VOICE_FOCUS_MOCK_MODE=false` and configure `OPENAI_API_KEY`. Use a current browser on localhost, allow microphone permission, speak for up to 90 seconds, stop, review the extracted plan, edit it, and confirm.

Run checks with:

```bash
npm run check
npm test
```

Suggested manual cases: permission denial, cancel recording, silent/unusable audio, no duration, several competing tasks, and a complete task/goal/duration example.

## Privacy

Raw audio is stored only as a temporary server file and deleted after success or failure. Complete transcripts are not logged by application code. The transcript and focus plan remain only in current browser memory. This prototype has no user accounts, cloud history, analytics, or database.

## Known limitations

- Real transcription and extraction require a funded, authorized OpenAI API key.
- Browser recording containers vary; the server accepts common WebM, Ogg, MP4/M4A, MP3, and WAV MIME types.
- The UI shows estimated processing stages because transcription and extraction currently share one HTTP request.
- Session state is lost on reload, matching the original prototype.
- The focus timer continues while the user is setting a return anchor or taking a break, preserving original behavior.
- Timer completion does not automatically end the session, also preserving original behavior.

## Future database extension

The documented session object in `public/app.js` separates planned details, actual duration, interruptions, and return anchors. A future server-side session repository could persist that shape in SQLite for a local prototype, PostgreSQL for a hosted service, or Supabase when managed authentication and row-level access become useful. No database is included in this version.
