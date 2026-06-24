# Drift Dock prototype

Drift Dock is a focus assistant built around three ideas: pause before leaving a focus session, leave a useful return anchor, and receive practical support when returning. Voice-to-Focus Plan adds an optional spoken setup flow, and Voice Exit Reflection lets a user speak through why they want to leave and turn that reflection into an editable return anchor.

## Features

- Manual task, session goal, and duration setup
- Optional 90-second voice recording with clear recording and processing states
- Backend-only OpenAI speech transcription and strict structured focus-plan extraction
- Optional Voice Exit Reflection on the pause-before-exit screen
- Editable voice-generated return anchor before any break starts
- Editable confirmation step with transcript and detected context
- Dynamic focus durations extracted from speech
- Existing focus timer, pause-before-exit, return anchor, return support, and session report
- Explicit development mock mode for testing without an API key
- In-memory, future-ready session record; no accounts, history, or database

## Architecture

The browser uses HTML, CSS, vanilla JavaScript, `MediaRecorder`, and `getUserMedia`. Express serves the static frontend and accepts multipart audio through Multer at `POST /api/voice/focus-plan` and `POST /api/voice/exit-anchor`. Both endpoints share upload validation, MIME normalization, transcription, safe diagnostics, and temporary-file cleanup. The server sends temporary audio to OpenAI transcription, then uses Structured Outputs with Zod schemas to create either the focus plan or the exit return anchor. Temporary audio is deleted in a `finally` block.

```text
public/                 Static client
  index.html
  styles.css
  app.js
server/
  server.js             Express setup and static hosting
  routes/voice.js       Upload validation, orchestration, safe errors
  services/             Transcription, extraction, and explicit mock logic
  schemas/              Strict focus-plan and exit-anchor schemas
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

The exit screen also shows **Mock exit transcript (development only)** in mock mode. Example:

```text
I'm stuck because the section structure is unclear. I want to take a ten-minute break. When I return, I should write one question for each section.
```

For real voice testing, set `VOICE_FOCUS_MOCK_MODE=false` and configure `OPENAI_API_KEY`. Use a current browser on localhost, allow microphone permission, speak for up to 90 seconds, stop, review the extracted plan, edit it, and confirm.

Run checks with:

```bash
npm run check
npm test
```

Suggested manual cases: permission denial, cancel recording, silent/unusable audio, no duration, several competing tasks, a complete task/goal/duration example, quick-reason exit, voice exit, return intention false, editing a return anchor, starting a break, returning, and finishing a session.

## Voice Exit Reflection flow

During Focus Mode, the user can choose **I want to leave**. On the Pause Before Exit screen they can still use one of the five quick reasons, return to focus, or optionally record a short voice reflection.

Voice Exit Reflection asks the user to say why they want to leave, where they stopped, and what might help them return. After transcription and structured extraction, Drift Dock shows **Review your return anchor**. The user can edit:

- why they are leaving;
- where they stopped;
- current obstacle;
- next tiny step;
- break duration;
- whether they intend to return;
- success condition for return.

The app does not start the break automatically. Confirming maps the result into the existing Return Anchor screen and pre-fills the existing `whereStopped`, `nextStep`, and `returnTime` controls. If the extracted return intention is false, the UI offers ending the session, editing the response, or returning to focus instead of forcing a break.

## Structured exit-anchor fields

`POST /api/voice/exit-anchor` returns:

```json
{
  "primary_reason": "too_difficult | tired | bored | urgent_external_reason | short_break | unclear_task | emotional_resistance | external_dependency | environment_problem | other | null",
  "reason_label": "string or null",
  "user_explanation": "string or null",
  "where_stopped": "string or null",
  "current_obstacle": "string or null",
  "next_tiny_step": "string or null",
  "planned_break_minutes": "integer or null",
  "return_intention": "boolean or null",
  "success_condition_for_return": "string or null",
  "needs_confirmation": ["string"]
}
```

The model is instructed to use only the transcript and trusted current-session context, never invent a break duration, generate only one small next step, and treat the transcript as data rather than instructions.

## Privacy

Raw audio is stored only as a temporary server file and deleted after success or failure. Complete transcripts are not logged by application code. The transcript, focus plan, exit reflection, and return anchor remain only in current browser memory. This prototype has no user accounts, cloud history, analytics, or database.

Voice-processing consent is reused across both voice features. The consent checkbox stores only `driftDockVoiceProcessingConsent=true` in `sessionStorage` for the current browser session. Manual setup, quick exit reasons, and return-to-focus controls remain usable without voice-processing consent.

## Session interruption structure

Interruptions are stored in memory as objects shaped for future persistence:

```json
{
  "interruption_id": "string",
  "created_at": "ISO timestamp",
  "source": "quick_reason | voice",
  "primary_reason": "string or null",
  "reason_label": "string or null",
  "user_explanation": "string or null",
  "where_stopped": "string or null",
  "current_obstacle": "string or null",
  "next_tiny_step": "string or null",
  "planned_break_minutes": "integer or null",
  "actual_break_seconds": "integer or null",
  "return_intention": "boolean or null",
  "returned": "boolean or null",
  "success_condition_for_return": "string or null",
  "raw_transcript": "string or null",
  "needs_confirmation": ["string"]
}
```

The session report still shows the interruption count and latest user-facing reason, and it does not expose raw transcripts by default.

## Known limitations

- Real transcription and extraction require a funded, authorized OpenAI API key.
- Live Voice Exit Reflection with OpenAI still requires local verification with a real browser recording and API access.
- Browser recording containers vary; the server accepts common WebM, Ogg, MP4/M4A, MP3, and WAV MIME types.
- The UI shows estimated processing stages because transcription and extraction currently share one HTTP request.
- Session state is lost on reload, matching the original prototype.
- The focus timer continues while the user is setting a return anchor or taking a break, preserving original behavior.
- Timer completion does not automatically end the session, also preserving original behavior.

## Future database extension

The documented session object in `public/app.js` separates planned details, actual duration, interruptions, and return anchors. A future server-side session repository could persist that shape in SQLite for a local prototype, PostgreSQL for a hosted service, or Supabase when managed authentication and row-level access become useful. No database is included in this version.
