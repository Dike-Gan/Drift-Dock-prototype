import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { extensionForMimeType, normalizeMimeType, recordingFilenameForMimeType } from "../server/audioFormats.js";
import { createVoiceRouter } from "../server/routes/voice.js";
import { transcribeAudio } from "../server/services/transcriptionService.js";
import { sanitizeDiagnosticMessage } from "../server/utils/safeLogger.js";
import { createMockExitAnchor } from "../server/services/mockExitAnchorService.js";
import { validateExitAnchor } from "../server/schemas/exitAnchorSchema.js";

const validPlan = {
  task_title:"Test browser audio", session_goal:"Verify upload handling", duration_minutes:15,
  broader_goal:null, current_problem:null, task_context:null, success_criteria:[],
  suggested_first_step:"Record one sentence", uncertainties:[], needs_confirmation:[]
};

const validExitAnchor = {
  primary_reason:"unclear_task",
  reason_label:"The task feels unclear",
  user_explanation:"The section structure is unclear.",
  where_stopped:"Working on the section structure.",
  current_obstacle:"Unsure what order the section should use.",
  next_tiny_step:"Write one question for each section.",
  planned_break_minutes:10,
  return_intention:true,
  success_condition_for_return:"Return after ten minutes and write the section questions.",
  needs_confirmation:[]
};

function captureLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      info(message, details) { entries.push({ level:"info", message, details }); },
      error(message, details) { entries.push({ level:"error", message, details }); }
    }
  };
}

async function withVoiceServer({ transcribe, extractExit = async () => validExitAnchor, logger }, callback) {
  const uploadsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "drift-dock-audio-"));
  const app = express();
  app.use("/api/voice", createVoiceRouter({
    uploadsDirectory,
    transcribe,
    extract:async () => validPlan,
    extractExit,
    logger
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await callback({ baseUrl:`http://127.0.0.1:${server.address().port}`, uploadsDirectory });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(uploadsDirectory, { recursive:true, force:true });
  }
}

function audioForm(type, filename, bytes = "browser audio bytes") {
  const form = new FormData();
  form.set("audio", new Blob([bytes], { type }), filename);
  return form;
}

test("normalizes codec parameters and maps supported MIME types to extensions", () => {
  assert.equal(normalizeMimeType(" audio/webm;codecs=opus "), "audio/webm");
  assert.equal(extensionForMimeType("audio/webm;codecs=opus"), ".webm");
  assert.equal(extensionForMimeType("audio/wav"), ".wav");
  assert.equal(recordingFilenameForMimeType("audio/x-m4a"), "recording.m4a");
});

for (const testCase of [
  { label:"WebM", type:"audio/webm", extension:".webm" },
  { label:"WebM with Opus codec", type:"audio/webm;codecs=opus", extension:".webm" },
  { label:"WAV", type:"audio/wav", extension:".wav" }
]) {
  test(`accepts ${testCase.label}, propagates a recognizable filename, and cleans up`, async () => {
    process.env.VOICE_FOCUS_MOCK_MODE = "false";
    const seen = [];
    const { logger, entries } = captureLogger();
    await withVoiceServer({
      logger,
      transcribe:async (file) => { seen.push(file); return "Test browser audio for 15 minutes."; }
    }, async ({ baseUrl, uploadsDirectory }) => {
      const response = await fetch(`${baseUrl}/api/voice/focus-plan`, {
        method:"POST", body:audioForm(testCase.type, `browser-capture${testCase.extension}`)
      });
      assert.equal(response.status, 200);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].mimeType, normalizeMimeType(testCase.type));
      assert.equal(seen[0].filename, `recording${testCase.extension}`);
      assert.ok(path.basename(seen[0].filePath).endsWith(testCase.extension));
      assert.deepEqual(await fs.readdir(uploadsDirectory), []);
      const diagnostic = entries.find((entry) => entry.level === "info")?.details;
      assert.equal(diagnostic.chosenExtension, testCase.extension);
      assert.ok(diagnostic.fileSizeBytes > 0);
      assert.ok(diagnostic.temporaryFilename.endsWith(testCase.extension));
    });
  });
}

test("rejects zero-byte and unsupported uploads", async () => {
  process.env.VOICE_FOCUS_MOCK_MODE = "false";
  const { logger } = captureLogger();
  await withVoiceServer({ logger, transcribe:async () => "unused" }, async ({ baseUrl, uploadsDirectory }) => {
    const emptyResponse = await fetch(`${baseUrl}/api/voice/focus-plan`, {
      method:"POST", body:audioForm("audio/webm", "recording.webm", new Uint8Array())
    });
    assert.equal(emptyResponse.status, 400);
    assert.equal((await emptyResponse.json()).error.code, "EMPTY_AUDIO");

    const unsupportedResponse = await fetch(`${baseUrl}/api/voice/focus-plan`, {
      method:"POST", body:audioForm("audio/aac", "recording.aac")
    });
    assert.equal(unsupportedResponse.status, 415);
    assert.equal((await unsupportedResponse.json()).error.code, "UNSUPPORTED_AUDIO_FORMAT");
    assert.deepEqual(await fs.readdir(uploadsDirectory), []);
  });
});

test("cleans up after transcription failure and logs only sanitized OpenAI diagnostics", async () => {
  process.env.VOICE_FOCUS_MOCK_MODE = "false";
  const { logger, entries } = captureLogger();
  const secret = "sk-test-secret-value";
  const error = Object.assign(new Error(`Unsupported file. Authorization: Bearer ${secret}`), {
    status:400, code:"invalid_value", type:"invalid_request_error"
  });
  await withVoiceServer({ logger, transcribe:async () => { throw error; } }, async ({ baseUrl, uploadsDirectory }) => {
    const response = await fetch(`${baseUrl}/api/voice/focus-plan`, {
      method:"POST", body:audioForm("audio/webm;codecs=opus", "recording.webm")
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await fs.readdir(uploadsDirectory), []);
    const serialized = JSON.stringify(entries);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("Bearer"), false);
    const diagnostic = entries.find((entry) => entry.level === "error")?.details;
    assert.deepEqual({ status:diagnostic.status, code:diagnostic.code, type:diagnostic.type }, {
      status:400, code:"invalid_value", type:"invalid_request_error"
    });
  });
});

test("toFile sends bytes with the requested filename and MIME type", async () => {
  const filePath = path.join(os.tmpdir(), `drift-dock-${crypto.randomUUID()}.webm`);
  await fs.writeFile(filePath, Buffer.from("recognizable audio bytes"));
  let captured;
  const client = { audio:{ transcriptions:{ create:async ({ file, model }) => {
    captured = { name:file.name, type:file.type, size:file.size, model };
    return { text:"A valid transcript" };
  } } } };
  try {
    const transcript = await transcribeAudio({
      filePath, filename:"recording.webm", mimeType:"audio/webm"
    }, { client });
    assert.equal(transcript, "A valid transcript");
    assert.deepEqual(captured, {
      name:"recording.webm", type:"audio/webm", size:24,
      model:process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe"
    });
  } finally {
    await fs.rm(filePath, { force:true });
  }
});

test("diagnostic sanitizer redacts secrets and collapses newlines", () => {
  const message = sanitizeDiagnosticMessage("Authorization: Bearer abc.def\nsk-example-secret");
  assert.equal(message.includes("abc.def"), false);
  assert.equal(message.includes("sk-example-secret"), false);
  assert.equal(message.includes("\n"), false);
});

test("exit-anchor endpoint reuses transcription, sends context, validates output, and cleans up", async () => {
  process.env.VOICE_FOCUS_MOCK_MODE = "false";
  const seen = {};
  const { logger } = captureLogger();
  await withVoiceServer({
    logger,
    transcribe:async (file) => {
      seen.transcribe = file;
      return "I'm stuck because the section structure is unclear. I want a ten-minute break.";
    },
    extractExit:async ({ transcript, sessionContext }) => {
      seen.extract = { transcript, sessionContext };
      return validateExitAnchor(validExitAnchor);
    }
  }, async ({ baseUrl, uploadsDirectory }) => {
    const form = audioForm("audio/webm;codecs=opus", "exit-recording.webm");
    form.set("sessionContext", JSON.stringify({ current_task:"Draft methods section", remaining_seconds:1200 }));
    const response = await fetch(`${baseUrl}/api/voice/exit-anchor`, { method:"POST", body:form });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.exitAnchor.primary_reason, "unclear_task");
    assert.equal(seen.transcribe.filename, "recording.webm");
    assert.equal(seen.transcribe.mimeType, "audio/webm");
    assert.equal(seen.extract.sessionContext.current_task, "Draft methods section");
    assert.match(seen.extract.transcript, /section structure/);
    assert.deepEqual(await fs.readdir(uploadsDirectory), []);
  });
});

test("mock exit-anchor keeps missing duration null and flags ambiguity", () => {
  const vague = createMockExitAnchor("I'm stuck and tired because the section is unclear. I need a short break and when I return I should write one question.");
  assert.equal(vague.planned_break_minutes, null);
  assert.ok(vague.needs_confirmation.some((item) => /duration/i.test(item)));
  assert.ok(vague.needs_confirmation.some((item) => /main reason/i.test(item)));
});

test("exit-anchor cleanup after failure and safe logging avoid transcripts and secrets", async () => {
  process.env.VOICE_FOCUS_MOCK_MODE = "false";
  const { logger, entries } = captureLogger();
  const secret = "sk-test-exit-secret";
  await withVoiceServer({
    logger,
    transcribe:async () => "This complete transcript should not be logged.",
    extractExit:async () => {
      const error = new Error(`Bad extraction Authorization: Bearer ${secret}`);
      error.code = "INVALID_STRUCTURED_OUTPUT";
      throw error;
    }
  }, async ({ baseUrl, uploadsDirectory }) => {
    const response = await fetch(`${baseUrl}/api/voice/exit-anchor`, {
      method:"POST", body:audioForm("audio/webm", "exit.webm")
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.error.code, "INVALID_STRUCTURED_OUTPUT");
    assert.deepEqual(await fs.readdir(uploadsDirectory), []);
    const serialized = JSON.stringify(entries);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("This complete transcript"), false);
  });
});
