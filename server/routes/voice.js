import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { transcribeAudio, MissingApiKeyError } from "../services/transcriptionService.js";
import { extractFocusPlan } from "../services/focusPlanService.js";
import { createMockFocusPlan } from "../services/mockFocusPlanService.js";

const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav",
  "audio/x-wav", "audio/m4a", "audio/x-m4a"
]);

function safeError(code, message, status = 500) {
  return { status, body: { success: false, error: { code, message } } };
}

export function createVoiceRouter({ uploadsDirectory }) {
  const router = Router();
  const maxBytes = Math.max(1, Number(process.env.MAX_AUDIO_SIZE_MB) || 20) * 1024 * 1024;
  const upload = multer({
    dest: uploadsDirectory,
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_request, file, callback) => {
      callback(SUPPORTED_AUDIO_TYPES.has(file.mimetype) ? null : new multer.MulterError("LIMIT_UNEXPECTED_FILE", "audio"), SUPPORTED_AUDIO_TYPES.has(file.mimetype));
    }
  });

  router.post("/focus-plan", (request, response) => {
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
        if (request.file && request.file.size === 0) {
          throw safeError("EMPTY_AUDIO", "The recording was empty. Please try again.", 400);
        }

        let transcript;
        try {
          transcript = mockMode
            ? (mockTranscript || "Mock recording: review the current task for 25 minutes and decide the next step.")
            : await transcribeAudio(uploadedPath);
        } catch (error) {
          if (error instanceof MissingApiKeyError) throw error;
          if (error?.code === "EMPTY_TRANSCRIPT") throw safeError("EMPTY_TRANSCRIPT", "No speech was detected. Please try again.", 422);
          throw safeError("TRANSCRIPTION_FAILED", "We could not transcribe the recording. Please try again.", 502);
        }
        if (!transcript.trim()) throw safeError("EMPTY_TRANSCRIPT", "No speech was detected. Please try again.", 422);

        let focusPlan;
        try {
          focusPlan = mockMode ? createMockFocusPlan(transcript) : await extractFocusPlan(transcript);
        } catch (error) {
          if (error instanceof MissingApiKeyError) throw error;
          if (error?.code === "INVALID_STRUCTURED_OUTPUT" || error?.name === "ZodError") {
            throw safeError("INVALID_STRUCTURED_OUTPUT", "We could not create a reliable focus plan. Please try again or use manual input.", 502);
          }
          throw safeError("AI_EXTRACTION_FAILED", "We could not analyze the transcript. Please try again or use manual input.", 502);
        }
        result = { status: 200, body: { success: true, mockMode, transcript, focusPlan } };
      } catch (error) {
        result = error?.body ? error : mapServiceError(error);
      } finally {
        if (uploadedPath) await fs.rm(path.resolve(uploadedPath), { force: true }).catch(() => {});
      }
      response.status(result.status).json(result.body);
    });
  });

  return router;
}

function mapServiceError(error) {
  if (error instanceof MissingApiKeyError) return safeError("MISSING_API_KEY", "Voice planning is not configured on this server. You can continue with manual input.", 503);
  return safeError("FOCUS_PLAN_FAILED", "We could not create the focus plan. Please try again or use manual input.", 502);
}
