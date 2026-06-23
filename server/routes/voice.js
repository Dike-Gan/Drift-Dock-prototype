import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { transcribeAudio, MissingApiKeyError } from "../services/transcriptionService.js";
import { extractFocusPlan } from "../services/focusPlanService.js";
import { extractExitAnchor } from "../services/exitAnchorService.js";
import { createMockFocusPlan } from "../services/mockFocusPlanService.js";
import { createMockExitAnchor } from "../services/mockExitAnchorService.js";
import { extensionForMimeType, normalizeMimeType } from "../audioFormats.js";
import { logOpenAIError, logUploadDiagnostics } from "../utils/safeLogger.js";

function safeError(code, message, status = 500) {
  return { status, body: { success: false, error: { code, message } } };
}

export function createVoiceRouter({
  uploadsDirectory,
  transcribe = transcribeAudio,
  extract = extractFocusPlan,
  extractExit = extractExitAnchor,
  logger = console
}) {
  const router = Router();
  const maxBytes = Math.max(1, Number(process.env.MAX_AUDIO_SIZE_MB) || 20) * 1024 * 1024;
  const storage = multer.diskStorage({
    destination: uploadsDirectory,
    filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${file.audioExtension}`)
  });
  const upload = multer({
    storage,
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_request, file, callback) => {
      file.normalizedMimeType = normalizeMimeType(file.mimetype);
      file.audioExtension = extensionForMimeType(file.normalizedMimeType);
      if (!file.audioExtension) {
        const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", "audio");
        error.uploadCode = "UNSUPPORTED_AUDIO_FORMAT";
        return callback(error);
      }
      callback(null, true);
    }
  });

  function withAudioUpload(handler) {
    return (request, response) => {
    upload.single("audio")(request, response, async (uploadError) => {
      let uploadedPath = request.file?.path;
      let result;
      try {
        if (uploadError) {
          if (uploadError.code === "LIMIT_FILE_SIZE") throw safeError("FILE_TOO_LARGE", "The recording is too large. Please record a shorter message.", 413);
          throw safeError("UNSUPPORTED_AUDIO_FORMAT", "This audio format is not supported by the server.", 415);
        }

        const mockMode = process.env.VOICE_FOCUS_MOCK_MODE === "true";
        const mockTranscript = request.body?.mockTranscript?.trim();
        if (!request.file && !(mockMode && mockTranscript)) {
          throw safeError("AUDIO_REQUIRED", "Please record some audio before creating a focus plan.", 400);
        }
        if (request.file) logUploadDiagnostics(logger, request.file);
        if (request.file && request.file.size === 0) {
          throw safeError("EMPTY_AUDIO", "The recording was empty. Please try again.", 400);
        }

        const transcript = await getTranscript({ request, uploadedPath, mockMode, mockTranscript, transcribe, logger });
        result = await handler({ request, transcript, mockMode });
      } catch (error) {
        result = error?.body ? error : mapServiceError(error);
      } finally {
        if (uploadedPath) await fs.rm(path.resolve(uploadedPath), { force: true }).catch(() => {});
      }
      response.status(result.status).json(result.body);
    });
    };
  }

  router.post("/focus-plan", withAudioUpload(async ({ transcript, mockMode }) => {
    let focusPlan;
    try {
      focusPlan = mockMode ? createMockFocusPlan(transcript) : await extract(transcript);
    } catch (error) {
      if (error instanceof MissingApiKeyError) throw error;
      if (error?.code === "INVALID_STRUCTURED_OUTPUT" || error?.name === "ZodError") {
        throw safeError("INVALID_STRUCTURED_OUTPUT", "We could not create a reliable focus plan. Please try again or use manual input.", 502);
      }
      throw safeError("AI_EXTRACTION_FAILED", "We could not analyze the transcript. Please try again or use manual input.", 502);
    }
    return { status: 200, body: { success: true, mockMode, transcript, focusPlan } };
  }));

  router.post("/exit-anchor", withAudioUpload(async ({ request, transcript, mockMode }) => {
    let exitAnchor;
    try {
      const sessionContext = parseSessionContext(request.body?.sessionContext);
      exitAnchor = mockMode ? createMockExitAnchor(transcript) : await extractExit({ transcript, sessionContext });
    } catch (error) {
      if (error instanceof MissingApiKeyError) throw error;
      if (error?.code === "INVALID_STRUCTURED_OUTPUT" || error?.name === "ZodError") {
        throw safeError("INVALID_STRUCTURED_OUTPUT", "We could not create a reliable return anchor. Please try again or use quick reasons.", 502);
      }
      throw safeError("AI_EXTRACTION_FAILED", "We could not analyze the exit reflection. Please try again or use quick reasons.", 502);
    }
    return { status: 200, body: { success: true, mockMode, transcript, exitAnchor } };
  }));

  return router;
}

async function getTranscript({ request, uploadedPath, mockMode, mockTranscript, transcribe, logger }) {
  let transcript;
  try {
    transcript = mockMode
      ? (mockTranscript || "Mock recording: review the current task for 25 minutes and decide the next step.")
      : await transcribe({
          filePath: uploadedPath,
          filename: `recording${request.file.audioExtension}`,
          mimeType: request.file.normalizedMimeType
        });
  } catch (error) {
    if (error instanceof MissingApiKeyError) throw error;
    if (error?.code === "EMPTY_AUDIO") throw safeError("EMPTY_AUDIO", "The recording was empty. Please try again.", 400);
    if (error?.code === "EMPTY_TRANSCRIPT") throw safeError("EMPTY_TRANSCRIPT", "No speech was detected. Please try again.", 422);
    logOpenAIError(logger, error);
    throw safeError("TRANSCRIPTION_FAILED", "We could not transcribe the recording. Please try again.", 502);
  }
  if (!transcript.trim()) throw safeError("EMPTY_TRANSCRIPT", "No speech was detected. Please try again.", 422);
  return transcript;
}

function parseSessionContext(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function mapServiceError(error) {
  if (error instanceof MissingApiKeyError) return safeError("MISSING_API_KEY", "Voice planning is not configured on this server. You can continue with manual input.", 503);
  return safeError("FOCUS_PLAN_FAILED", "We could not create the focus plan. Please try again or use manual input.", 502);
}
