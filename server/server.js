import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createVoiceRouter } from "./routes/voice.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(here, "..");
const publicDirectory = path.join(rootDirectory, "public");
const uploadsDirectory = path.join(rootDirectory, "uploads");
fs.mkdirSync(uploadsDirectory, { recursive: true });

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.get("/api/config", (_request, response) => {
  response.json({
    voiceFocusMockMode: process.env.VOICE_FOCUS_MOCK_MODE === "true",
    maxRecordingSeconds: 90,
    maxAudioSizeMb: Math.max(1, Number(process.env.MAX_AUDIO_SIZE_MB) || 20)
  });
});
app.use("/api/voice", createVoiceRouter({ uploadsDirectory }));
app.use(express.static(publicDirectory));

app.use((error, _request, response, _next) => {
  console.error("Unhandled request error:", error?.message || "Unknown error");
  response.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
});

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    const mode = process.env.VOICE_FOCUS_MOCK_MODE === "true" ? "mock" : "OpenAI";
    console.log(`Drift Dock running at http://localhost:${port} (voice mode: ${mode})`);
  });
}
