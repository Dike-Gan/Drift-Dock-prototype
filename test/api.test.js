import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.VOICE_FOCUS_MOCK_MODE = "true";
process.env.MAX_AUDIO_SIZE_MB = "1";
const { app } = await import("../server/server.js");
let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test("serves the frontend and exposes explicit mock configuration", async () => {
  const page = await fetch(baseUrl); assert.equal(page.status, 200); assert.match(await page.text(), /Voice-to-Focus Plan/);
  const config = await (await fetch(`${baseUrl}/api/config`)).json(); assert.equal(config.voiceFocusMockMode, true);
});

test("creates a valid mock focus plan with an explicit duration", async () => {
  const form = new FormData();
  form.set("mockTranscript", "I need to prepare a seminar presentation. During this session I want to define the structure for 40 minutes.");
  const response = await fetch(`${baseUrl}/api/voice/focus-plan`, { method:"POST", body:form });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.success, true); assert.equal(body.mockMode, true); assert.equal(body.focusPlan.duration_minutes, 40);
});

test("does not infer a missing duration and flags competing tasks", async () => {
  const form = new FormData(); form.set("mockTranscript", "I need to outline the report and also answer email, but I am unsure which task comes first.");
  const body = await (await fetch(`${baseUrl}/api/voice/focus-plan`, { method:"POST", body:form })).json();
  assert.equal(body.focusPlan.duration_minutes, null); assert.ok(body.focusPlan.needs_confirmation.length > 0);
});

test("creates a valid mock exit return anchor with explicit duration", async () => {
  const form = new FormData();
  form.set("mockTranscript", "I'm stuck because the section structure is unclear. I want to take a ten-minute break. When I return, I should write one question for each section.");
  form.set("sessionContext", JSON.stringify({ current_task:"Draft report section", remaining_seconds:900 }));
  const response = await fetch(`${baseUrl}/api/voice/exit-anchor`, { method:"POST", body:form });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.mockMode, true);
  assert.equal(body.exitAnchor.planned_break_minutes, 10);
  assert.equal(body.exitAnchor.return_intention, true);
  assert.match(body.exitAnchor.next_tiny_step, /question/i);
});

test("rejects unsupported audio and leaves no temporary file", async () => {
  const uploads = path.resolve("uploads"); const beforeFiles = await fs.readdir(uploads);
  const form = new FormData(); form.set("audio", new Blob(["not audio"], { type:"text/plain" }), "bad.txt");
  const response = await fetch(`${baseUrl}/api/voice/focus-plan`, { method:"POST", body:form });
  assert.equal(response.status, 415); const afterFiles = await fs.readdir(uploads); assert.deepEqual(afterFiles, beforeFiles);
});

test("exit anchor rejects unsupported audio and leaves no temporary file", async () => {
  const uploads = path.resolve("uploads"); const beforeFiles = await fs.readdir(uploads);
  const form = new FormData(); form.set("audio", new Blob(["not audio"], { type:"text/plain" }), "bad.txt");
  const response = await fetch(`${baseUrl}/api/voice/exit-anchor`, { method:"POST", body:form });
  assert.equal(response.status, 415); const afterFiles = await fs.readdir(uploads); assert.deepEqual(afterFiles, beforeFiles);
});

test("rejects an empty request", async () => {
  const response = await fetch(`${baseUrl}/api/voice/focus-plan`, { method:"POST", body:new FormData() });
  assert.equal(response.status, 400); const body = await response.json(); assert.equal(body.error.code, "AUDIO_REQUIRED");
});

test("rejects an empty audio recording", async () => {
  const form = new FormData(); form.set("audio", new Blob([], { type:"audio/webm" }), "empty.webm");
  const response = await fetch(`${baseUrl}/api/voice/focus-plan`, { method:"POST", body:form });
  assert.equal(response.status, 400); const body = await response.json(); assert.ok(["AUDIO_REQUIRED", "EMPTY_AUDIO"].includes(body.error.code));
});

test("rejects audio above the configured size limit and cleans it up", async () => {
  const uploads = path.resolve("uploads");
  const form = new FormData(); form.set("audio", new Blob([new Uint8Array(1024 * 1024 + 1)], { type:"audio/webm" }), "large.webm");
  const response = await fetch(`${baseUrl}/api/voice/focus-plan`, { method:"POST", body:form });
  assert.equal(response.status, 413); const body = await response.json(); assert.equal(body.error.code, "FILE_TOO_LARGE");
  const afterFiles = await fs.readdir(uploads); assert.deepEqual(afterFiles, [".gitkeep"]);
});

test("returns a safe configuration error when real mode has no API key", async () => {
  process.env.VOICE_FOCUS_MOCK_MODE = "false"; delete process.env.OPENAI_API_KEY;
  try {
    const form = new FormData(); form.set("audio", new Blob(["audio data"], { type:"audio/webm" }), "sample.webm");
    const response = await fetch(`${baseUrl}/api/voice/focus-plan`, { method:"POST", body:form });
    assert.equal(response.status, 503); const body = await response.json(); assert.equal(body.error.code, "MISSING_API_KEY"); assert.equal(JSON.stringify(body).includes("stack"), false);
  } finally { process.env.VOICE_FOCUS_MOCK_MODE = "true"; }
});
