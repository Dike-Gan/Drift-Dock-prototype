const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]+\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi,
  /\bAuthorization\s*:\s*[^,;\r\n]+/gi
];

export function sanitizeDiagnosticMessage(value) {
  let message = typeof value === "string" ? value : "OpenAI request failed";
  for (const pattern of SECRET_PATTERNS) message = message.replace(pattern, "[REDACTED]");
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}

export function logUploadDiagnostics(logger, file) {
  logger.info("Voice upload received", {
    mimeType: file.mimetype,
    normalizedMimeType: file.normalizedMimeType,
    originalFilename: file.originalname,
    fileSizeBytes: file.size,
    temporaryFilename: file.filename,
    chosenExtension: file.audioExtension
  });
}

export function logOpenAIError(logger, error) {
  logger.error("OpenAI transcription failed", {
    status: error?.status ?? null,
    code: error?.code ?? error?.error?.code ?? null,
    type: error?.type ?? error?.error?.type ?? null,
    message: sanitizeDiagnosticMessage(error?.error?.message || error?.message)
  });
}
