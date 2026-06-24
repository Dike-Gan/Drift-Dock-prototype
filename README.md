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
- Prototype-only local profiles for Dike, Ruiqi, and additional local testers
- Local History, session detail, deterministic Insights, JSON export, and JSON import
- Versioned localStorage schema with migration-ready storage helpers
- Explicit development mock mode for testing without an API key
- Future-ready session records; no secure accounts, cloud sync, analytics, or database

## Architecture

The browser uses HTML, CSS, vanilla JavaScript, `MediaRecorder`, `getUserMedia`, `sessionStorage` for voice-processing consent, and `localStorage` for prototype-only local profiles and history. Express serves the static frontend and accepts multipart audio through Multer at `POST /api/voice/focus-plan` and `POST /api/voice/exit-anchor`. Both endpoints share upload validation, MIME normalization, transcription, safe diagnostics, and temporary-file cleanup. The server sends temporary audio to OpenAI transcription, then uses Structured Outputs with Zod schemas to create either the focus plan or the exit return anchor. Temporary audio is deleted in a `finally` block.

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
test/frontend.test.js   Browser-flow, local history, and insights tests
uploads/.gitkeep        Temporary upload directory (contents ignored)
```

The frontend keeps all local persistence behind a small storage service in `public/app.js`. That service is responsible for reading, validating, migrating, writing, exporting, importing, and clearing Drift Dock data. Raw `localStorage` access is not scattered through the app.

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

Raw audio is stored only as a temporary server file and deleted after success or failure. Complete transcripts are not logged by application code. Full raw transcripts are not stored in local history or included in Insights or JSON export by default. The structured focus plan, structured interruptions, completion reflection, and timing fields may be saved locally in browser `localStorage` so the prototype can be used across sessions on one device.

This prototype has no secure user accounts, cloud history, analytics, or database. Local profile history remains visible to anyone with access to the same browser profile. Local history is not encrypted separately from browser storage. Clearing browser data, reinstalling the browser, or using another device will not restore history unless a JSON backup was exported.

Voice-processing consent is reused across both voice features. The consent checkbox stores only `driftDockVoiceProcessingConsent=true` in `sessionStorage` for the current browser session. Manual setup, quick exit reasons, and return-to-focus controls remain usable without voice-processing consent.

## Local profiles and localStorage

Drift Dock creates two default local profiles: Dike and Ruiqi. Additional local profile names can be created for testing. Profiles can be selected, renamed, and deleted from Settings. The selector is only a local filter; it is not authentication and it is not secure account separation.

Each profile has:

```json
{
  "profile_id": "string",
  "display_name": "string",
  "created_at": "ISO timestamp"
}
```

The active profile is remembered in `localStorage`, and History and Insights always filter to that active profile. Switching profiles does not mix session lists. Deleting a profile requires confirmation and removes that profile's local sessions.

The local data root is versioned:

```json
{
  "schema_version": 1,
  "active_profile_id": "dike",
  "profiles": [],
  "sessions": [],
  "settings": {}
}
```

The storage service can recover from malformed local data by recreating a safe default structure. Future schema versions should be added through the migration helper rather than changing stored fields ad hoc.

## Session lifecycle and time calculations

Sessions are saved or updated when a session starts, an interruption is created, a return anchor is confirmed, a break starts, the user returns, the session is completed or abandoned, and when the page is hidden or unloaded. Drift Dock does not write to `localStorage` every second.

Stored sessions include stable IDs and ownership metadata:

```json
{
  "schema_version": 1,
  "session_id": "string",
  "local_profile_id": "string",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "started_at": "ISO timestamp",
  "ended_at": "ISO timestamp or null",
  "status": "active | paused | completed | abandoned | expired",
  "task_title": "string",
  "session_goal": "string",
  "broader_goal": "string or null",
  "task_context": "string or null",
  "current_problem": "string or null",
  "suggested_first_step": "string or null",
  "success_criteria": ["string"],
  "planned_duration_minutes": "integer",
  "actual_focus_seconds": "integer",
  "total_break_seconds": "integer",
  "elapsed_session_seconds": "integer",
  "time_until_first_interruption_seconds": "integer or null",
  "interruptions": [],
  "goal_achieved": "yes | partly | no | unsure | null",
  "completion_note": "string or null",
  "completion_status": "string or null"
}
```

`actual_focus_seconds` increases only during active focus. Break time and exit-reflection time do not count as focus time. `total_break_seconds` tracks actual break duration, and `elapsed_session_seconds` tracks the whole session from start to end. `time_until_first_interruption_seconds` is recorded from accumulated focus time at the first interruption.

If the browser closes during an unfinished session, the next visit offers recovery actions for the active profile: resume, view saved state, mark abandoned, or delete the unfinished session. Drift Dock does not automatically resume the timer.

## Session interruption structure

Interruptions are stored as normalized objects shaped for future persistence:

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
  "needs_confirmation": ["string"]
}
```

Quick-reason interruptions and Voice Exit Reflection interruptions use the same normalized structure. The interruption count is derived from the array length. Returning from a break updates the matching interruption with return time, returned status, and actual break seconds. History, Insights, reports, and export do not expose raw transcripts by default.

## Completion reflection

Before completing or abandoning a session, Drift Dock asks:

```text
Did you achieve the goal of this session?
```

The available answers are Yes, Partly, No, and Not sure. The optional "What did you accomplish?" note is saved as `completion_note`. Users can skip the note, complete immediately, or mark a session abandoned without a long reflection.

## History and session detail

The History section groups sessions by date for the active profile. Each card shows task title, session goal, start time, planned duration, actual focus duration, interruption count, completion status, and goal-achievement status. Opening a card shows the session detail, including planned and actual time, break time, start and end time, completion reflection, interruption timeline, interruption reasons, return success, and return-anchor details.

One session can be deleted from the detail view after confirmation.

## Insights

Insights are calculated deterministically from local history without OpenAI. Time ranges are Today, Last 7 Days, and Last 30 Days.

The current metrics include:

- total actual focus time;
- planned focus time;
- number of sessions;
- average actual session duration;
- completed sessions;
- goal-achievement distribution;
- total interruptions;
- average interruptions per session;
- most common interruption reason;
- reason counts;
- average time until first interruption when available;
- return intentions, successful returns, return rate, and average actual break duration;
- planned focus time compared with actual focus time and percentage completed.

The Daily Summary is generated from local calculations only. Simple accessible bar-style visualizations summarize daily actual focus time, interruption reasons, and goal achievement. The same information is also available as text.

## Export and import

Settings includes **Export history as JSON** for the active profile. Export includes schema version, export timestamp, selected profile, that profile's sessions, and migration-relevant settings. It does not include API keys, environment values, raw audio, voice consent, unrelated browser data, or raw transcripts by default. Filenames are sanitized and follow a pattern such as `drift-dock-dike-2026-06-24.json`.

Settings also includes **Import history from JSON**. Import validates the schema before accepting data, rejects malformed or unsupported files, shows a preview with profile name, session count, date range, and schema version, and then offers merge or replace. Duplicate sessions are skipped by `session_id`; data is not silently overwritten.

## Clearing data

Settings provides:

- Clear current profile history
- Delete current local profile
- Clear all Drift Dock local data

Each action requires confirmation and affects only Drift Dock's own localStorage key. These controls do not delete unrelated browser storage, server configuration, or `.env`.

## Known limitations

- Real transcription and extraction require a funded, authorized OpenAI API key.
- Live Voice Exit Reflection with OpenAI still requires local verification with a real browser recording and API access.
- Browser recording containers vary; the server accepts common WebM, Ogg, MP4/M4A, MP3, and WAV MIME types.
- The UI shows estimated processing stages because transcription and extraction currently share one HTTP request.
- Local profiles are not secure accounts.
- Local history is stored only in this browser on this device and is not synchronized.
- Clearing browser storage deletes local history.
- Reinstalling or changing browsers may lose history.
- There is no cloud backup; JSON export is the current backup method.
- Local history is not encrypted separately from browser storage.
- Browser restart recovery depends on the browser preserving `localStorage`.
- Timer completion does not automatically end the session, preserving original prototype behavior.

## Future database extension

The documented session object in `public/app.js` separates planned details, actual duration, interruptions, and return anchors. No database is included in this version.

Future account migration mapping:

```text
local_profile_id -> authenticated user_id
local session object -> focus_sessions row
interruptions[] -> interruptions rows
```

Stable IDs use `crypto.randomUUID()` where supported, with a fallback for older browsers. Array indexes should not be used as permanent identifiers.
