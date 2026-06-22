export const AUDIO_EXTENSION_BY_MIME_TYPE = Object.freeze({
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".mp4",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a"
});

export function normalizeMimeType(value = "") {
  return String(value).split(";", 1)[0].trim().toLowerCase();
}

export function extensionForMimeType(value) {
  return AUDIO_EXTENSION_BY_MIME_TYPE[normalizeMimeType(value)] || null;
}

export function recordingFilenameForMimeType(value) {
  const extension = extensionForMimeType(value);
  return extension ? `recording${extension}` : null;
}
