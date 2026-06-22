import fs from "node:fs/promises";
import OpenAI, { toFile } from "openai";

export class MissingApiKeyError extends Error {
  constructor() {
    super("OPENAI_API_KEY is not configured.");
    this.name = "MissingApiKeyError";
  }
}

export async function transcribeAudio({ filePath, filename, mimeType }, { client } = {}) {
  if (!client && !process.env.OPENAI_API_KEY) throw new MissingApiKeyError();

  const audioBytes = await fs.readFile(filePath);
  if (audioBytes.byteLength === 0) {
    const error = new Error("The uploaded audio file is empty.");
    error.code = "EMPTY_AUDIO";
    throw error;
  }

  const openAIClient = client || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const audioFile = await toFile(audioBytes, filename, { type: mimeType });
  const result = await openAIClient.audio.transcriptions.create({
    file: audioFile,
    model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe"
  });

  const transcript = result.text?.trim();
  if (!transcript) {
    const error = new Error("The transcription was empty.");
    error.code = "EMPTY_TRANSCRIPT";
    throw error;
  }
  return transcript;
}
