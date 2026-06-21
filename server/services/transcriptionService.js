import fs from "node:fs";
import OpenAI from "openai";

export class MissingApiKeyError extends Error {
  constructor() {
    super("OPENAI_API_KEY is not configured.");
    this.name = "MissingApiKeyError";
  }
}

export async function transcribeAudio(filePath) {
  if (!process.env.OPENAI_API_KEY) throw new MissingApiKeyError();

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
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
