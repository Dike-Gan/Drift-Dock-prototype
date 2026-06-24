const MAX_RECORDING_SECONDS = 90;
const VOICE_PROCESSING_CONSENT_KEY = "driftDockVoiceProcessingConsent";
const LOCAL_DATA_KEY = "driftDockLocalData";
const LOCAL_SCHEMA_VERSION = 1;

const DriftDockStorage = (() => {
  const defaultProfiles = () => [
    { profile_id:"dike", display_name:"Dike", created_at:new Date().toISOString() },
    { profile_id:"ruiqi", display_name:"Ruiqi", created_at:new Date().toISOString() }
  ];
  const blank = () => ({ schema_version:LOCAL_SCHEMA_VERSION, active_profile_id:"dike", profiles:defaultProfiles(), sessions:[], settings:{ store_raw_transcripts:false } });
  function read() {
    try {
      const raw = localStorage.getItem(LOCAL_DATA_KEY);
      return migrate(raw ? JSON.parse(raw) : blank());
    } catch {
      return blank();
    }
  }
  function migrate(data) {
    if (!data || typeof data !== "object") return blank();
    if (data.schema_version !== LOCAL_SCHEMA_VERSION) data.schema_version = LOCAL_SCHEMA_VERSION;
    if (!Array.isArray(data.profiles) || !data.profiles.length) data.profiles = defaultProfiles();
    if (!Array.isArray(data.sessions)) data.sessions = [];
    if (!data.settings || typeof data.settings !== "object") data.settings = {};
    if (typeof data.settings.store_raw_transcripts !== "boolean") data.settings.store_raw_transcripts = false;
    if (!data.active_profile_id || !data.profiles.some((profile) => profile.profile_id === data.active_profile_id)) data.active_profile_id = data.profiles[0].profile_id;
    data.profiles = data.profiles.map(validateProfile);
    data.sessions = data.sessions.map(validateSession).filter(Boolean);
    return data;
  }
  function write(data) {
    const migrated = migrate(data);
    localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(migrated));
    return migrated;
  }
  function activeProfile(data = read()) { return data.profiles.find((profile) => profile.profile_id === data.active_profile_id) || data.profiles[0]; }
  function sessionsForActive(data = read()) { return data.sessions.filter((item) => item.local_profile_id === data.active_profile_id); }
  function upsertSession(sessionRecord) {
    const data = read();
    const record = validateSession({ ...sessionRecord, local_profile_id:sessionRecord.local_profile_id || data.active_profile_id, updated_at:new Date().toISOString() });
    const index = data.sessions.findIndex((item) => item.session_id === record.session_id);
    if (index >= 0) data.sessions[index] = record; else data.sessions.push(record);
    write(data);
    return record;
  }
  function deleteSession(sessionId) {
    const data = read();
    data.sessions = data.sessions.filter((item) => item.session_id !== sessionId);
    write(data);
  }
  function createProfile(name) {
    const data = read();
    const id = slugify(name) || `profile-${Date.now()}`;
    const uniqueId = data.profiles.some((profile) => profile.profile_id === id) ? `${id}-${Date.now()}` : id;
    data.profiles.push({ profile_id:uniqueId, display_name:safeText(name, 80) || "New profile", created_at:new Date().toISOString() });
    data.active_profile_id = uniqueId;
    return write(data);
  }
  function renameProfile(profileId, name) {
    const data = read();
    const profile = data.profiles.find((item) => item.profile_id === profileId);
    if (profile) profile.display_name = safeText(name, 80) || profile.display_name;
    return write(data);
  }
  function deleteProfile(profileId, deleteHistory = true) {
    const data = read();
    if (data.profiles.length <= 1) throw new Error("At least one local profile is required.");
    data.profiles = data.profiles.filter((profile) => profile.profile_id !== profileId);
    if (deleteHistory) data.sessions = data.sessions.filter((item) => item.local_profile_id !== profileId);
    if (data.active_profile_id === profileId) data.active_profile_id = data.profiles[0].profile_id;
    return write(data);
  }
  function setActiveProfile(profileId) {
    const data = read();
    if (data.profiles.some((profile) => profile.profile_id === profileId)) data.active_profile_id = profileId;
    return write(data);
  }
  function clearProfileHistory(profileId) {
    const data = read();
    data.sessions = data.sessions.filter((item) => item.local_profile_id !== profileId);
    return write(data);
  }
  function clearAll() { localStorage.removeItem(LOCAL_DATA_KEY); return write(blank()); }
  function exportProfile(profileId = read().active_profile_id) {
    const data = read();
    const profile = data.profiles.find((item) => item.profile_id === profileId);
    const sessions = data.sessions.filter((item) => item.local_profile_id === profileId).map(stripSessionForExport);
    return { schema_version:LOCAL_SCHEMA_VERSION, exported_at:new Date().toISOString(), profile, sessions, settings:{ store_raw_transcripts:false } };
  }
  function importPreview(payload) {
    const parsed = validateImportPayload(payload);
    const dates = parsed.sessions.map((item) => item.started_at || item.created_at).filter(Boolean).sort();
    return { payload:parsed, profile_name:parsed.profile?.display_name || "Imported profile", session_count:parsed.sessions.length, schema_version:parsed.schema_version, date_range:dates.length ? `${dates[0].slice(0,10)} to ${dates.at(-1).slice(0,10)}` : "No dated sessions" };
  }
  function importProfile(payload, mode = "merge") {
    const parsed = validateImportPayload(payload);
    const data = read();
    const profile = validateProfile(parsed.profile || { profile_id:`import-${Date.now()}`, display_name:"Imported profile", created_at:new Date().toISOString() });
    if (!data.profiles.some((item) => item.profile_id === profile.profile_id)) data.profiles.push(profile);
    if (mode === "replace") data.sessions = data.sessions.filter((item) => item.local_profile_id !== data.active_profile_id);
    let imported = 0, skipped = 0;
    const targetProfileId = mode === "replace" ? data.active_profile_id : profile.profile_id;
    for (const sessionRecord of parsed.sessions) {
      const normalized = validateSession({ ...sessionRecord, local_profile_id:targetProfileId });
      if (!normalized) { skipped++; continue; }
      if (data.sessions.some((item) => item.session_id === normalized.session_id)) { skipped++; continue; }
      data.sessions.push(normalized); imported++;
    }
    write(data);
    return { imported, skipped, rejected:0 };
  }
  return { key:LOCAL_DATA_KEY, blank, read, write, migrate, activeProfile, sessionsForActive, upsertSession, deleteSession, createProfile, renameProfile, deleteProfile, setActiveProfile, clearProfileHistory, clearAll, exportProfile, importPreview, importProfile };
})();

window.__driftDockStorage = DriftDockStorage;

// Future-ready session record. This version stays in browser memory only.
// Interruption objects are shaped for a future database table but remain local in this prototype.
const session = {
  schema_version: LOCAL_SCHEMA_VERSION,
  session_id: crypto.randomUUID?.() || String(Date.now()),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  started_at: null,
  ended_at: null,
  status: "active",
  local_profile_id: "dike",
  task_title: "",
  session_goal: "",
  planned_duration_minutes: 45,
  actual_focus_seconds: 0,
  total_break_seconds: 0,
  elapsed_session_seconds: 0,
  time_until_first_interruption_seconds: null,
  actual_focus_duration_seconds: null,
  broader_goal: "",
  current_problem: "",
  task_context: "",
  success_criteria: [],
  suggested_first_step: "",
  uncertainties: [],
  raw_transcript: "",
  interruptions: [],
  active_interruption_id: null,
  return_anchors: [],
  goal_achieved: null,
  completion_status: "",
  secondsLeft: 2700,
  timer: null,
  focusStartedAt: null,
  focusSegmentStartedAt: null,
  breakStartedAt: null,
  lastPersistedAt: 0,
  pendingExitAnchor: null
};

let localData = null;
let pendingImport = null;

const $ = (id) => document.getElementById(id);

const focusVoice = {
  name: "focus",
  state: "idle",
  stream: null,
  recorder: null,
  chunks: [],
  startedAt: 0,
  clock: null,
  maxTimer: null,
  requestActive: false,
  cancelled: false,
  startId: "recordButton",
  actionsId: "recordingActions",
  stopId: "stopButton",
  cancelId: "cancelRecordingButton",
  timerId: "recordingTimer",
  statusId: "voiceStatus",
  statusTextId: "voiceStatusText",
  errorId: "voiceError",
  mockControlsId: "mockControls",
  mockTranscriptId: "mockTranscript",
  mockAnalyzeId: "analyzeMockButton",
  idleText: "Ready to record · up to 90 seconds",
  recordingText: "Recording — speak naturally. Stop when your plan is clear.",
  cancelledText: "Recording cancelled. Ready to try again.",
  emptyText: "The recording was empty. Please try again.",
  endpoint: "/api/voice/focus-plan",
  submit: submitFocusVoicePlan
};

const exitVoice = {
  name: "exit",
  state: "idle",
  stream: null,
  recorder: null,
  chunks: [],
  startedAt: 0,
  clock: null,
  maxTimer: null,
  requestActive: false,
  cancelled: false,
  startId: "exitRecordButton",
  actionsId: "exitRecordingActions",
  stopId: "exitStopButton",
  cancelId: "exitCancelRecordingButton",
  timerId: "exitRecordingTimer",
  statusId: "exitVoiceStatus",
  statusTextId: "exitVoiceStatusText",
  errorId: "exitVoiceError",
  mockControlsId: "exitMockControls",
  mockTranscriptId: "exitMockTranscript",
  mockAnalyzeId: "analyzeExitMockButton",
  idleText: "Ready to record an exit reflection · up to 90 seconds",
  recordingText: "Recording — explain what is making you leave.",
  cancelledText: "Exit reflection cancelled. Quick reasons are still available.",
  emptyText: "The exit recording was empty. Please try again or use quick reasons.",
  endpoint: "/api/voice/exit-anchor",
  submit: submitExitVoicePlan
};

const voiceFlows = [focusVoice, exitVoice];
const reasonMap = {
  "Too difficult": "too_difficult",
  "Too tired": "tired",
  "Too boring": "bored",
  "Urgent external reason": "urgent_external_reason",
  "Just want a short break": "short_break"
};

function validateProfile(profile) {
  return {
    profile_id: safeText(profile.profile_id, 80) || `profile-${Date.now()}`,
    display_name: safeText(profile.display_name, 80) || "Local profile",
    created_at: validIso(profile.created_at) || new Date().toISOString()
  };
}

function validateSession(value) {
  if (!value || typeof value !== "object" || !value.session_id) return null;
  const planned = Number(value.planned_duration_minutes) || 45;
  return {
    schema_version: LOCAL_SCHEMA_VERSION,
    session_id: safeText(value.session_id, 120),
    local_profile_id: safeText(value.local_profile_id, 120) || "dike",
    created_at: validIso(value.created_at) || new Date().toISOString(),
    updated_at: validIso(value.updated_at) || new Date().toISOString(),
    started_at: validIso(value.started_at) || validIso(value.created_at) || new Date().toISOString(),
    ended_at: validIso(value.ended_at),
    status: ["active","paused","completed","abandoned","expired"].includes(value.status) ? value.status : "active",
    task_title: safeText(value.task_title, 240) || "Untitled task",
    session_goal: safeText(value.session_goal, 400) || "Make progress",
    broader_goal: safeText(value.broader_goal, 500),
    task_context: safeText(value.task_context, 800),
    current_problem: safeText(value.current_problem, 500),
    suggested_first_step: safeText(value.suggested_first_step, 500),
    success_criteria: Array.isArray(value.success_criteria) ? value.success_criteria.map((item) => safeText(item, 240)).filter(Boolean).slice(0, 10) : [],
    planned_duration_minutes: Math.max(1, Math.min(180, planned)),
    actual_focus_seconds: Math.max(0, Number(value.actual_focus_seconds) || 0),
    total_break_seconds: Math.max(0, Number(value.total_break_seconds) || 0),
    elapsed_session_seconds: Math.max(0, Number(value.elapsed_session_seconds) || 0),
    time_until_first_interruption_seconds: value.time_until_first_interruption_seconds == null ? null : Math.max(0, Number(value.time_until_first_interruption_seconds) || 0),
    interruptions: Array.isArray(value.interruptions) ? value.interruptions.map(validateInterruption).filter(Boolean) : [],
    goal_achieved: ["yes","partly","no","unsure"].includes(value.goal_achieved) ? value.goal_achieved : null,
    completion_note: safeText(value.completion_note, 800),
    completion_status: safeText(value.completion_status, 80)
  };
}

function validateInterruption(value) {
  if (!value || typeof value !== "object") return null;
  return {
    interruption_id: safeText(value.interruption_id, 120) || `interruption-${Date.now()}`,
    created_at: validIso(value.created_at) || new Date().toISOString(),
    source: ["quick_reason","voice"].includes(value.source) ? value.source : "quick_reason",
    primary_reason: safeText(value.primary_reason, 120),
    reason_label: safeText(value.reason_label, 180),
    user_explanation: safeText(value.user_explanation, 500),
    where_stopped: safeText(value.where_stopped, 500),
    current_obstacle: safeText(value.current_obstacle, 500),
    next_tiny_step: safeText(value.next_tiny_step, 500),
    planned_break_minutes: value.planned_break_minutes == null ? null : Math.max(1, Math.min(180, Number(value.planned_break_minutes) || 1)),
    actual_break_seconds: value.actual_break_seconds == null ? null : Math.max(0, Number(value.actual_break_seconds) || 0),
    return_intention: typeof value.return_intention === "boolean" ? value.return_intention : null,
    returned: typeof value.returned === "boolean" ? value.returned : null,
    return_time: validIso(value.return_time),
    success_condition_for_return: safeText(value.success_condition_for_return, 500),
    needs_confirmation: Array.isArray(value.needs_confirmation) ? value.needs_confirmation.map((item) => safeText(item, 240)).filter(Boolean).slice(0, 10) : []
  };
}

function validateImportPayload(payload) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!parsed || parsed.schema_version !== LOCAL_SCHEMA_VERSION || !Array.isArray(parsed.sessions)) throw new Error("Unsupported or malformed Drift Dock export.");
  return { schema_version:LOCAL_SCHEMA_VERSION, exported_at:validIso(parsed.exported_at) || new Date().toISOString(), profile:validateProfile(parsed.profile || {}), sessions:parsed.sessions.map(validateSession).filter(Boolean), settings:{ store_raw_transcripts:false } };
}

function stripSessionForExport(record) {
  const clean = validateSession(record);
  clean.interruptions = clean.interruptions.map(({ raw_transcript, ...item }) => item);
  return clean;
}

function safeText(value, max = 500) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/[<>]/g, "").slice(0, max) : null;
}

function validIso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

document.addEventListener("DOMContentLoaded", async () => {
  localData = DriftDockStorage.read();
  session.local_profile_id = localData.active_profile_id;
  bindEvents();
  renderProfileSelector();
  renderRecovery();
  renderHistory();
  renderInsights();
  renderSettings();
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    setMockMode(Boolean(config.voiceFocusMockMode));
  } catch {
    showFlowError(focusVoice, "The backend is unavailable. You can still use manual input.");
    showFlowError(exitVoice, "The backend is unavailable. Quick reasons are still available.");
  }
});

function bindEvents() {
  $("manualForm").addEventListener("submit", (event) => { event.preventDefault(); startManualSession(); });
  $("voiceProcessingConsent").addEventListener("change", handleVoiceConsentChange);
  $("exitVoiceProcessingConsent").addEventListener("change", handleVoiceConsentChange);

  bindVoiceFlow(focusVoice);
  bindVoiceFlow(exitVoice);

  $("confirmationForm").addEventListener("submit", confirmVoicePlan);
  $("recordAgainButton").addEventListener("click", resetForRecording);
  $("cancelVoiceButton").addEventListener("click", returnToManual);
  $("exitAnchorForm").addEventListener("submit", confirmExitAnchor);
  $("exitRecordAgainButton").addEventListener("click", () => { showScreen("exit"); resetVoiceControls(exitVoice); clearFlowError(exitVoice); setFlowStatus(exitVoice, "idle", exitVoice.idleText); $(exitVoice.startId).focus(); });
  $("exitUseQuickReasonsButton").addEventListener("click", () => { showScreen("exit"); clearFlowError(exitVoice); $("reasonChoices").querySelector("button")?.focus(); });
  $("exitReturnFocusButton").addEventListener("click", () => showScreen("focus"));
  $("exitEndSessionButton").addEventListener("click", completeSession);
  $("exitClearVoiceErrorButton").addEventListener("click", () => { clearFlowError(exitVoice); setFlowStatus(exitVoice, "idle", exitVoice.idleText); });

  document.addEventListener("click", (event) => { const id = event.target.dataset.screen; if (id) showScreen(id); });
  $("reasonChoices").addEventListener("click", (event) => { if (event.target.dataset.reason) selectReason(event.target.dataset.reason); });
  $("finishSessionButton").addEventListener("click", completeSession);
  $("startBreakButton").addEventListener("click", startBreak);
  $("endBecauseLeftButton").addEventListener("click", completeSession);
  $("returnButton").addEventListener("click", showReturn);
  $("smallerStepButton").addEventListener("click", generateSmallerStep);
  $("resetButton").addEventListener("click", () => location.reload());
  $("profileSelector").addEventListener("change", handleProfileSwitch);
  document.querySelectorAll("[data-nav-screen]").forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.navScreen)));
  $("completionForm").addEventListener("submit", finishFromCompletion);
  $("completeImmediatelyButton").addEventListener("click", () => finalizeSession("completed", document.querySelector('input[name="goalAchieved"]:checked')?.value || "unsure", ""));
  $("abandonSessionButton").addEventListener("click", () => finalizeSession("abandoned", "unsure", $("completionNote").value.trim()));
  $("resumeSessionButton").addEventListener("click", resumeSavedSession);
  $("viewSavedSessionButton").addEventListener("click", () => { showScreen("history"); const saved = unfinishedSessionForActive(); if (saved) renderSessionDetail(saved.session_id); });
  $("markAbandonedButton").addEventListener("click", () => abandonSavedSession());
  $("deleteUnfinishedButton").addEventListener("click", deleteUnfinishedSession);
  $("insightRange").addEventListener("change", renderInsights);
  $("profileForm").addEventListener("submit", renameActiveProfile);
  $("createProfileForm").addEventListener("submit", createLocalProfile);
  $("exportProfileButton").addEventListener("click", exportActiveProfile);
  $("importHistoryInput").addEventListener("change", previewImportFile);
  $("mergeImportButton").addEventListener("click", () => applyImport("merge"));
  $("replaceImportButton").addEventListener("click", () => applyImport("replace"));
  $("clearProfileHistoryButton").addEventListener("click", clearActiveProfileHistory);
  $("deleteProfileButton").addEventListener("click", deleteActiveProfile);
  $("clearAllDataButton").addEventListener("click", clearAllLocalData);
  $("deleteSessionButton").addEventListener("click", deleteSelectedSession);
  document.addEventListener("visibilitychange", () => { if (document.hidden) persistCurrentSession(true); });
  window.addEventListener("beforeunload", () => persistCurrentSession(true));
  initVoiceConsent();
}

function bindVoiceFlow(flow) {
  $(flow.startId).addEventListener("click", () => beginVoiceRecording(flow));
  $(flow.stopId).addEventListener("click", () => stopVoiceRecording(flow, false));
  $(flow.cancelId).addEventListener("click", () => cancelVoiceRecording(flow));
  $(flow.mockAnalyzeId).addEventListener("click", () => analyzeMockTranscript(flow));
}

function setMockMode(enabled) {
  voiceFlows.forEach((flow) => {
    flow.mockMode = enabled;
    $(flow.mockControlsId).hidden = !enabled;
  });
  $("voiceModeBadge").hidden = !enabled;
  $("exitVoiceModeBadge").hidden = !enabled;
  if (enabled) {
    setFlowStatus(focusVoice, "idle", "Mock mode is active — no OpenAI request will be made.");
    setFlowStatus(exitVoice, "idle", "Mock mode is active — no OpenAI request will be made.");
  }
}

function showScreen(id) {
  if (id !== "focus") pauseFocusClock();
  if (id === "focus" && session.completion_status === "in_progress") resumeFocusClock();
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  document.querySelectorAll("[data-nav-screen]").forEach((button) => button.classList.toggle("active", button.dataset.navScreen === navRootFor(id)));
  if (id === "history") renderHistory();
  if (id === "insights") renderInsights();
  if (id === "settings") renderSettings();
  $(id)?.querySelector("h1,h2")?.focus?.({ preventScroll:true });
  window.scrollTo({ top:0, behavior:"smooth" });
}

function navRootFor(id) {
  return ["history","insights","settings"].includes(id) ? id : "start";
}

async function beginVoiceRecording(flow) {
  if (flow.requestActive || flow.state === "recording") return;
  clearFlowError(flow);
  if (!hasVoiceProcessingConsent()) {
    updateVoiceConsentStatus(false);
    return showFlowError(flow, "Please review and accept the voice processing notice before recording.");
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return showFlowError(flow, "This browser does not support voice recording. Please use manual input or a current browser.");
  }
  setFlowStatus(flow, "requesting", "Requesting microphone permission…");
  disableFlowStart(flow, true);
  try {
    flow.stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
    flow.chunks = [];
    flow.cancelled = false;
    flow.recorder = preferred ? new MediaRecorder(flow.stream, { mimeType:preferred }) : new MediaRecorder(flow.stream);
    flow.recorder.addEventListener("dataavailable", (event) => { if (event.data.size) flow.chunks.push(event.data); });
    flow.recorder.addEventListener("stop", () => handleRecordingStopped(flow), { once:true });
    flow.recorder.start(250);
    flow.startedAt = Date.now();
    flow.clock = setInterval(() => updateRecordingClock(flow), 250);
    flow.maxTimer = setTimeout(() => stopVoiceRecording(flow, false, true), MAX_RECORDING_SECONDS * 1000);
    $(flow.startId).hidden = true;
    $(flow.actionsId).hidden = false;
    $(flow.timerId).hidden = false;
    setFlowStatus(flow, "recording", flow.recordingText);
    updateRecordingClock(flow);
  } catch (error) {
    disableFlowStart(flow, false);
    setFlowStatus(flow, "error", "Microphone access failed.");
    const message = error.name === "NotAllowedError"
      ? "Microphone permission was denied. Allow access in browser settings or use manual input."
      : error.name === "NotFoundError"
        ? "No microphone was found. Connect one or use manual input."
        : "The microphone could not be started. Please try again or use manual input.";
    showFlowError(flow, message);
    releaseMicrophone(flow);
  }
}

function updateRecordingClock(flow) {
  const seconds = Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - flow.startedAt) / 1000));
  $(flow.timerId).textContent = formatTime(seconds);
}

function stopVoiceRecording(flow, cancelled, reachedLimit = false) {
  if (!flow.recorder || flow.recorder.state === "inactive") return;
  flow.cancelled = cancelled;
  if (reachedLimit) setFlowStatus(flow, "recording", "Maximum recording length reached. Processing your recording…");
  flow.recorder.stop();
}

function cancelVoiceRecording(flow) {
  stopVoiceRecording(flow, true);
  resetVoiceControls(flow);
  setFlowStatus(flow, "idle", flow.cancelledText);
}

async function handleRecordingStopped(flow) {
  clearRecordingTimers(flow);
  releaseMicrophone(flow);
  const blob = new Blob(flow.chunks, { type:flow.recorder?.mimeType || "audio/webm" });
  flow.chunks = [];
  if (flow.cancelled) return;
  resetVoiceControls(flow);
  if (!blob.size) return showFlowError(flow, flow.emptyText);
  await flow.submit(blob);
}

async function analyzeMockTranscript(flow) {
  if (!flow.mockMode || flow.requestActive) return;
  const transcript = $(flow.mockTranscriptId).value.trim();
  if (!transcript) return showFlowError(flow, "Enter a mock transcript to test this voice flow.");
  await flow.submit(null, transcript);
}

async function submitFocusVoicePlan(blob, mockTranscript = "") {
  if (focusVoice.requestActive) return showFlowError(focusVoice, "A focus plan request is already in progress.");
  focusVoice.requestActive = true;
  disableFlowStart(focusVoice, true);
  $("manualSubmitButton").disabled = true;
  clearFlowError(focusVoice);
  const form = new FormData();
  if (blob) form.append("audio", blob, extensionFor(blob.type));
  if (mockTranscript) form.append("mockTranscript", mockTranscript);
  setFlowStatus(focusVoice, "uploading", "Uploading recording securely…");
  const transcribingHint = setTimeout(() => setFlowStatus(focusVoice, "transcribing", "Transcribing your plan…"), 500);
  const analyzingHint = setTimeout(() => setFlowStatus(focusVoice, "analyzing", "Turning the transcript into a focus plan…"), 1600);
  try {
    const response = await fetch(focusVoice.endpoint, { method:"POST", body:form });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error?.message || "The backend could not process the recording.");
    populateConfirmation(result.transcript, result.focusPlan);
    setFlowStatus(focusVoice, "success", result.mockMode ? "Mock focus plan ready for review." : "Focus plan ready for review.");
    showScreen("confirmation");
  } catch (error) {
    setFlowStatus(focusVoice, "error", "Voice plan failed.");
    showFlowError(focusVoice, error.message === "Failed to fetch" ? "The backend is unavailable. Please try again or use manual input." : error.message);
  } finally {
    clearTimeout(transcribingHint);
    clearTimeout(analyzingHint);
    focusVoice.requestActive = false;
    disableFlowStart(focusVoice, false);
    $("manualSubmitButton").disabled = false;
  }
}

async function submitExitVoicePlan(blob, mockTranscript = "") {
  if (exitVoice.requestActive) return showFlowError(exitVoice, "An exit reflection request is already in progress.");
  exitVoice.requestActive = true;
  disableFlowStart(exitVoice, true);
  clearFlowError(exitVoice);
  const form = new FormData();
  if (blob) form.append("audio", blob, extensionFor(blob.type));
  if (mockTranscript) form.append("mockTranscript", mockTranscript);
  form.append("sessionContext", JSON.stringify(currentExitSessionContext()));
  setFlowStatus(exitVoice, "uploading", "Uploading exit reflection securely…");
  const transcribingHint = setTimeout(() => setFlowStatus(exitVoice, "transcribing", "Transcribing your reflection…"), 500);
  const analyzingHint = setTimeout(() => setFlowStatus(exitVoice, "analyzing", "Building your return anchor…"), 1600);
  try {
    const response = await fetch(exitVoice.endpoint, { method:"POST", body:form });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error?.message || "The backend could not process the exit reflection.");
    populateExitAnchorConfirmation(result.transcript, result.exitAnchor);
    setFlowStatus(exitVoice, "success", result.mockMode ? "Mock return anchor ready for review." : "Return anchor ready for review.");
    showScreen("exit-confirmation");
  } catch (error) {
    setFlowStatus(exitVoice, "error", "Exit reflection failed.");
    showFlowError(exitVoice, error.message === "Failed to fetch" ? "The backend is unavailable. Quick reasons are still available." : error.message);
  } finally {
    clearTimeout(transcribingHint);
    clearTimeout(analyzingHint);
    exitVoice.requestActive = false;
    disableFlowStart(exitVoice, false);
  }
}

function populateConfirmation(transcript, plan) {
  session.raw_transcript = transcript;
  $("rawTranscript").textContent = transcript;
  $("confirmTask").value = plan.task_title || "";
  $("confirmGoal").value = plan.session_goal || "";
  $("confirmDuration").value = plan.duration_minutes || "";
  $("confirmFirstStep").value = plan.suggested_first_step || "";
  session.broader_goal = plan.broader_goal || "";
  session.current_problem = plan.current_problem || "";
  session.task_context = plan.task_context || "";
  session.success_criteria = plan.success_criteria || [];
  session.uncertainties = plan.uncertainties || [];
  const fields = [["Broader goal",plan.broader_goal],["Current problem",plan.current_problem],["Task context",plan.task_context],["Success criteria",plan.success_criteria],["Uncertainties",plan.uncertainties],["Needs confirmation",plan.needs_confirmation]];
  const content = $("contextContent");
  content.replaceChildren();
  let count = 0;
  const list = document.createElement("dl");
  for (const [label,value] of fields) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    if (!values.length) continue;
    count++;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (values.length === 1) {
      dd.textContent = values[0];
    } else {
      const ul = document.createElement("ul");
      values.forEach((item) => { const li = document.createElement("li"); li.textContent = item; ul.append(li); });
      dd.append(ul);
    }
    list.append(dt, dd);
  }
  content.append(list);
  $("additionalContext").hidden = count === 0;
}

function confirmVoicePlan(event) {
  event.preventDefault();
  const task = $("confirmTask").value.trim();
  const goal = $("confirmGoal").value.trim();
  const duration = Number($("confirmDuration").value);
  if (!task || !goal) return;
  if (duration && (duration < 1 || duration > 180)) return showFlowError(focusVoice, "Focus duration must be between 1 and 180 minutes.");
  $("task").value = task;
  $("goal").value = goal;
  if (duration) ensureDurationOption(duration);
  session.suggested_first_step = $("confirmFirstStep").value.trim();
  startSession(task, goal, duration || 45);
}

function populateExitAnchorConfirmation(transcript, anchor) {
  session.pendingExitAnchor = { transcript, anchor };
  $("exitReasonLabel").value = anchor.reason_label || friendlyReason(anchor.primary_reason) || "";
  $("exitWhereStopped").value = anchor.where_stopped || "";
  $("exitCurrentObstacle").value = anchor.current_obstacle || "";
  $("exitNextTinyStep").value = anchor.next_tiny_step || "";
  $("exitBreakDuration").value = anchor.planned_break_minutes || "";
  $("exitReturnIntention").value = anchor.return_intention === true ? "true" : anchor.return_intention === false ? "false" : "";
  $("exitSuccessCondition").value = anchor.success_condition_for_return || "";
  $("exitRawTranscript").textContent = transcript;
  renderNeedsConfirmation(anchor.needs_confirmation || []);
  $("exitNoReturnNotice").hidden = anchor.return_intention !== false;
}

function renderNeedsConfirmation(items) {
  const details = $("exitNeedsConfirmation");
  const list = $("exitNeedsConfirmationList");
  list.replaceChildren();
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  });
  details.hidden = items.length === 0;
}

function confirmExitAnchor(event) {
  event.preventDefault();
  const returnValue = $("exitReturnIntention").value;
  if (!returnValue) return showFlowError(exitVoice, "Confirm whether you intend to return before starting a break.");
  if (returnValue === "false") return showFlowError(exitVoice, "This response says you do not intend to return. Choose End session, Return to focus, or edit the intention before starting a break.");

  const anchor = session.pendingExitAnchor?.anchor || {};
  const breakMinutes = Number($("exitBreakDuration").value) || null;
  const interruption = appendInterruption({
    source: "voice",
    primary_reason: anchor.primary_reason || "other",
    reason_label: $("exitReasonLabel").value.trim() || friendlyReason(anchor.primary_reason) || "Voice exit reflection",
    user_explanation: anchor.user_explanation || null,
    where_stopped: $("exitWhereStopped").value.trim() || null,
    current_obstacle: $("exitCurrentObstacle").value.trim() || null,
    next_tiny_step: $("exitNextTinyStep").value.trim() || null,
    planned_break_minutes: breakMinutes,
    return_intention: true,
    success_condition_for_return: $("exitSuccessCondition").value.trim() || null,
    raw_transcript: session.pendingExitAnchor?.transcript || null,
    needs_confirmation: anchor.needs_confirmation || []
  });
  session.active_interruption_id = interruption.interruption_id;
  $("reasonText").textContent = interruption.reason_label || "Voice exit reflection";
  $("whereStopped").value = interruption.where_stopped || "";
  $("nextStep").value = interruption.next_tiny_step || "";
  if (breakMinutes) ensureReturnTimeOption(breakMinutes);
  showScreen("break");
}

function startManualSession() {
  if (focusVoice.requestActive || focusVoice.state === "recording" || focusVoice.state === "requesting") {
    return showFlowError(focusVoice, "Finish or cancel the active voice request before starting manually.");
  }
  session.raw_transcript = "";
  session.suggested_first_step = "";
  startSession($("task").value.trim() || "Untitled task", $("goal").value.trim() || "Make progress", Number($("duration").value));
}

function startSession(task, goal, duration) {
  const now = new Date().toISOString();
  Object.assign(session, {
    schema_version: LOCAL_SCHEMA_VERSION,
    session_id: crypto.randomUUID?.() || String(Date.now()),
    local_profile_id: DriftDockStorage.read().active_profile_id,
    created_at: now,
    updated_at: now,
    started_at: now,
    ended_at: null,
    status: "active",
    actual_focus_seconds: 0,
    total_break_seconds: 0,
    elapsed_session_seconds: 0,
    time_until_first_interruption_seconds: null,
    interruptions: [],
    return_anchors: [],
    active_interruption_id: null,
    goal_achieved: null,
    completion_note: null
  });
  session.task_title = task;
  session.session_goal = goal;
  session.planned_duration_minutes = duration;
  session.secondsLeft = duration * 60;
  session.focusStartedAt = Date.now();
  session.focusSegmentStartedAt = Date.now();
  session.completion_status = "in_progress";
  $("showTask").textContent = task;
  $("showGoal").textContent = goal;
  $("showFirstStep").textContent = session.suggested_first_step;
  $("firstStepCard").hidden = !session.suggested_first_step;
  updateTimer();
  if (session.timer) clearInterval(session.timer);
  session.timer = setInterval(() => {
    if (session.completion_status === "in_progress" && session.focusSegmentStartedAt) updateTimer();
    persistCurrentSession(false);
  }, 1000);
  persistCurrentSession(true);
  showScreen("focus");
}

function updateTimer() {
  const activeSeconds = session.actual_focus_seconds + (session.focusSegmentStartedAt ? Math.floor((Date.now() - session.focusSegmentStartedAt) / 1000) : 0);
  session.secondsLeft = Math.max(0, session.planned_duration_minutes * 60 - activeSeconds);
  const minutes = Math.floor(session.secondsLeft / 60);
  const seconds = session.secondsLeft % 60;
  $("timeLeft").textContent = `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
  const used = 1 - session.secondsLeft / (session.planned_duration_minutes * 60);
  const degrees = Math.max(0, Math.min(360, used * 360));
  $("timerCircle").style.background = `conic-gradient(var(--primary) ${degrees}deg, var(--primary-light) ${degrees}deg)`;
}

function selectReason(reason) {
  pauseFocusClock();
  const interruption = appendInterruption({
    source: "quick_reason",
    primary_reason: reasonMap[reason] || "other",
    reason_label: reason,
    return_intention: true
  });
  session.active_interruption_id = interruption.interruption_id;
  if (session.time_until_first_interruption_seconds == null) session.time_until_first_interruption_seconds = session.actual_focus_seconds;
  $("reasonText").textContent = reason;
  if (reason === "Urgent external reason") {
    $("whereStopped").value = "I had to leave because something else became more urgent.";
    $("nextStep").value = "When I return, first check what was open and decide whether to continue or reschedule.";
  } else if (reason === "Too difficult") {
    $("nextStep").value = "Make the next step smaller: work only for 2 minutes on the easiest part.";
  } else if (reason === "Too tired") {
    $("nextStep").value = "After the break, do one low-energy step, such as reading one paragraph or organizing one slide.";
  }
  persistCurrentSession(true);
  showScreen("break");
}

function startBreak() {
  pauseFocusClock();
  const anchor = {
    created_at: new Date().toISOString(),
    where_stopped: $("whereStopped").value.trim(),
    next_step: $("nextStep").value.trim(),
    return_plan: $("returnTime").value
  };
  session.return_anchors.push(anchor);
  session.breakStartedAt = Date.now();
  session.status = "paused";
  updateActiveInterruption({
    where_stopped: anchor.where_stopped || null,
    next_tiny_step: anchor.next_step || null,
    planned_break_minutes: parseReturnMinutes(anchor.return_plan),
    returned: false
  });
  persistCurrentSession(true);
  $("returnPlan").textContent = anchor.return_plan;
  showScreen("onbreak");
}

function showReturn() {
  const anchor = session.return_anchors.at(-1) || {};
  const breakSeconds = session.breakStartedAt ? Math.max(0, Math.floor((Date.now() - session.breakStartedAt) / 1000)) : null;
  if (breakSeconds) session.total_break_seconds += breakSeconds;
  updateActiveInterruption({
    returned: true,
    actual_break_seconds: breakSeconds,
    return_time: new Date().toISOString()
  });
  session.breakStartedAt = null;
  session.status = "active";
  persistCurrentSession(true);
  $("returnStopped").textContent = anchor.where_stopped || "No note added.";
  $("returnNext").textContent = anchor.next_step || "Open the task and do one tiny step for 2 minutes.";
  $("aiBox").hidden = true;
  showScreen("return");
}

function generateSmallerStep() {
  $("aiSuggestion").textContent = "For the next 2 minutes: open the task, look only at the last sentence or slide, and write one imperfect bullet point. Stop after that if needed.";
  $("aiBox").hidden = false;
}

function completeSession() {
  if (!session.session_id || session.completion_status !== "in_progress") return finalizeSession("completed", "unsure", "");
  pauseFocusClock();
  showScreen("completion");
}

function appendInterruption(values) {
  if (session.time_until_first_interruption_seconds == null) session.time_until_first_interruption_seconds = session.actual_focus_seconds;
  const interruption = {
    interruption_id: crypto.randomUUID?.() || `${Date.now()}-${session.interruptions.length}`,
    created_at: new Date().toISOString(),
    source: values.source || "quick_reason",
    primary_reason: values.primary_reason ?? null,
    reason_label: values.reason_label ?? null,
    user_explanation: values.user_explanation ?? null,
    where_stopped: values.where_stopped ?? null,
    current_obstacle: values.current_obstacle ?? null,
    next_tiny_step: values.next_tiny_step ?? null,
    planned_break_minutes: values.planned_break_minutes ?? null,
    actual_break_seconds: values.actual_break_seconds ?? null,
    return_intention: values.return_intention ?? null,
    returned: values.returned ?? null,
    success_condition_for_return: values.success_condition_for_return ?? null,
    raw_transcript: values.raw_transcript ?? null,
    needs_confirmation: values.needs_confirmation ?? [],
    reason: values.reason_label ?? null
  };
  session.interruptions.push(interruption);
  persistCurrentSession(true);
  return interruption;
}

function updateActiveInterruption(values) {
  const interruption = session.interruptions.find((item) => item.interruption_id === session.active_interruption_id);
  if (interruption) Object.assign(interruption, values);
  persistCurrentSession(true);
}

function pauseFocusClock() {
  if (!session.focusSegmentStartedAt) return;
  session.actual_focus_seconds += Math.max(0, Math.floor((Date.now() - session.focusSegmentStartedAt) / 1000));
  session.actual_focus_duration_seconds = session.actual_focus_seconds;
  session.focusSegmentStartedAt = null;
  updateElapsedSession();
}

function resumeFocusClock() {
  if (!session.session_id || session.status !== "active" || session.focusSegmentStartedAt) return;
  session.focusSegmentStartedAt = Date.now();
}

function updateElapsedSession() {
  if (!session.started_at) return;
  const end = session.ended_at ? Date.parse(session.ended_at) : Date.now();
  session.elapsed_session_seconds = Math.max(0, Math.floor((end - Date.parse(session.started_at)) / 1000));
}

function persistCurrentSession(force = false) {
  if (!session.session_id || !session.started_at || !session.task_title) return;
  const now = Date.now();
  if (!force && now - session.lastPersistedAt < 15000) return;
  updateElapsedSession();
  session.lastPersistedAt = now;
  session.updated_at = new Date().toISOString();
  DriftDockStorage.upsertSession(toPersistedSession());
  renderRecovery();
}

function toPersistedSession() {
  const focusNow = session.actual_focus_seconds + (session.focusSegmentStartedAt ? Math.floor((Date.now() - session.focusSegmentStartedAt) / 1000) : 0);
  return {
    schema_version: LOCAL_SCHEMA_VERSION,
    session_id: session.session_id,
    local_profile_id: session.local_profile_id,
    created_at: session.created_at,
    updated_at: new Date().toISOString(),
    started_at: session.started_at,
    ended_at: session.ended_at,
    status: session.status,
    task_title: session.task_title,
    session_goal: session.session_goal,
    broader_goal: session.broader_goal || null,
    task_context: session.task_context || null,
    current_problem: session.current_problem || null,
    suggested_first_step: session.suggested_first_step || null,
    success_criteria: session.success_criteria || [],
    planned_duration_minutes: session.planned_duration_minutes,
    actual_focus_seconds: focusNow,
    total_break_seconds: session.total_break_seconds,
    elapsed_session_seconds: session.elapsed_session_seconds,
    time_until_first_interruption_seconds: session.time_until_first_interruption_seconds,
    interruptions: session.interruptions.map(({ raw_transcript, reason, ...item }) => item),
    goal_achieved: session.goal_achieved,
    completion_note: session.completion_note || null,
    completion_status: session.completion_status || null
  };
}

function finishFromCompletion(event) {
  event.preventDefault();
  finalizeSession("completed", document.querySelector('input[name="goalAchieved"]:checked')?.value || "unsure", $("completionNote").value.trim());
}

function finalizeSession(status, goalAchieved = "unsure", note = "") {
  pauseFocusClock();
  if (session.timer) clearInterval(session.timer);
  session.status = status;
  session.ended_at = new Date().toISOString();
  session.goal_achieved = goalAchieved;
  session.completion_note = note || null;
  session.completion_status = status;
  updateElapsedSession();
  persistCurrentSession(true);
  $("reportTask").textContent = session.task_title || "Untitled task";
  $("reportInterruptions").textContent = String(session.interruptions.length);
  $("reportReason").textContent = session.interruptions.at(-1)?.reason_label || session.interruptions.at(-1)?.reason || "No interruption recorded";
  $("reportGoalAchieved").textContent = labelGoal(goalAchieved);
  $("reportCompletionNote").textContent = note || "No note added.";
  renderHistory();
  renderInsights();
  showScreen("report");
}

function labelGoal(value) {
  return { yes:"Yes", partly:"Partly", no:"No", unsure:"Not sure" }[value] || "Not recorded";
}

function currentExitSessionContext() {
  return {
    current_task: session.task_title || null,
    current_session_goal: session.session_goal || null,
    suggested_first_step: session.suggested_first_step || null,
    planned_duration_minutes: session.planned_duration_minutes || null,
    remaining_seconds: session.secondsLeft,
    previous_interruptions: session.interruptions.map((item) => ({
      source: item.source,
      primary_reason: item.primary_reason,
      reason_label: item.reason_label,
      current_obstacle: item.current_obstacle,
      returned: item.returned
    })),
    latest_return_anchor: session.return_anchors.at(-1) || null
  };
}

function renderProfileSelector() {
  localData = DriftDockStorage.read();
  const selector = $("profileSelector");
  selector.replaceChildren();
  localData.profiles.forEach((profile) => selector.add(new Option(profile.display_name, profile.profile_id)));
  selector.value = localData.active_profile_id;
}

function handleProfileSwitch(event) {
  persistCurrentSession(true);
  localData = DriftDockStorage.setActiveProfile(event.target.value);
  renderProfileSelector();
  renderRecovery();
  renderHistory();
  renderInsights();
  renderSettings();
  showScreen("start");
}

function unfinishedSessionForActive() {
  return DriftDockStorage.sessionsForActive().find((item) => ["active","paused"].includes(item.status));
}

function renderRecovery() {
  const saved = unfinishedSessionForActive();
  $("recoveryCard").hidden = !saved || saved.session_id === session.session_id;
  if (saved) $("recoverySummary").textContent = `${saved.task_title} · ${saved.status} · ${formatMinutes(saved.actual_focus_seconds)} focused so far.`;
}

function resumeSavedSession() {
  const saved = unfinishedSessionForActive();
  if (!saved) return;
  Object.assign(session, saved, {
    secondsLeft: Math.max(0, saved.planned_duration_minutes * 60 - saved.actual_focus_seconds),
    focusSegmentStartedAt: saved.status === "active" ? Date.now() : null,
    completion_status: saved.completion_status || "in_progress",
    return_anchors: []
  });
  $("showTask").textContent = session.task_title;
  $("showGoal").textContent = session.session_goal;
  $("showFirstStep").textContent = session.suggested_first_step || "";
  $("firstStepCard").hidden = !session.suggested_first_step;
  updateTimer();
  if (session.timer) clearInterval(session.timer);
  session.timer = setInterval(() => { if (session.focusSegmentStartedAt) updateTimer(); persistCurrentSession(false); }, 1000);
  showScreen(saved.status === "paused" ? "onbreak" : "focus");
}

function abandonSavedSession() {
  const saved = unfinishedSessionForActive();
  if (!saved || !confirm(`Mark "${saved.task_title}" as abandoned?`)) return;
  DriftDockStorage.upsertSession({ ...saved, status:"abandoned", ended_at:new Date().toISOString(), completion_status:"abandoned", goal_achieved:"unsure" });
  renderRecovery(); renderHistory(); renderInsights();
}

function deleteUnfinishedSession() {
  const saved = unfinishedSessionForActive();
  if (!saved || !confirm(`Delete unfinished session "${saved.task_title}" from local history?`)) return;
  DriftDockStorage.deleteSession(saved.session_id);
  renderRecovery(); renderHistory(); renderInsights();
}

function renderHistory() {
  const list = $("historyList");
  if (!list) return;
  const sessions = DriftDockStorage.sessionsForActive().sort((a,b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  list.replaceChildren();
  clearSessionDetail();
  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.textContent = "No local sessions yet for this profile.";
    list.append(empty);
    return;
  }
  let currentDay = "";
  sessions.slice(0, 100).forEach((record) => {
    const day = dayLabel(record.started_at);
    if (day !== currentDay) {
      currentDay = day;
      const heading = document.createElement("h3");
      heading.className = "history-day";
      heading.textContent = day;
      list.append(heading);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-card";
    button.innerHTML = `<strong>${escapeHtml(record.task_title)}</strong><div class="history-meta">${escapeHtml(record.session_goal)}<br>${timeLabel(record.started_at)} · ${record.planned_duration_minutes} min planned · ${formatMinutes(record.actual_focus_seconds)} focused<br>${record.interruptions.length} interruption${record.interruptions.length === 1 ? "" : "s"} · ${record.status} · Goal: ${labelGoal(record.goal_achieved)}</div>`;
    button.addEventListener("click", () => renderSessionDetail(record.session_id));
    list.append(button);
  });
}

function renderSessionDetail(sessionId) {
  const record = DriftDockStorage.sessionsForActive().find((item) => item.session_id === sessionId);
  if (!record) {
    clearSessionDetail();
    return;
  }
  $("sessionDetail").hidden = false;
  $("sessionDetail").dataset.sessionId = sessionId;
  const interruptions = record.interruptions.map((item) => `<li><strong>${escapeHtml(item.reason_label || item.primary_reason || "Interruption")}</strong> · ${timeLabel(item.created_at)}<br>${escapeHtml(item.where_stopped || "No stop point")} · ${escapeHtml(item.next_tiny_step || "No next step")}<br>Returned: ${item.returned === true ? "yes" : item.returned === false ? "no" : "unknown"}</li>`).join("");
  $("sessionDetailContent").innerHTML = `<dl class="details-content"><dt>Task</dt><dd>${escapeHtml(record.task_title)}</dd><dt>Goal</dt><dd>${escapeHtml(record.session_goal)}</dd><dt>Planned</dt><dd>${record.planned_duration_minutes} minutes</dd><dt>Actual focus</dt><dd>${formatMinutes(record.actual_focus_seconds)}</dd><dt>Break time</dt><dd>${formatMinutes(record.total_break_seconds)}</dd><dt>Status</dt><dd>${record.status}</dd><dt>Goal achieved</dt><dd>${labelGoal(record.goal_achieved)}</dd><dt>Completion note</dt><dd>${escapeHtml(record.completion_note || "No note added.")}</dd><dt>Interruptions</dt><dd><ol>${interruptions || "<li>No interruptions</li>"}</ol></dd></dl>`;
}

function clearSessionDetail() {
  if (!$("sessionDetail")) return;
  $("sessionDetail").hidden = true;
  $("sessionDetail").dataset.sessionId = "";
  $("sessionDetailContent").replaceChildren();
}

function deleteSelectedSession() {
  const sessionId = $("sessionDetail").dataset.sessionId;
  if (!sessionId || !confirm("Delete this one local session?")) return;
  DriftDockStorage.deleteSession(sessionId);
  $("sessionDetail").hidden = true;
  renderHistory(); renderInsights(); renderRecovery();
}

function renderInsights() {
  const range = $("insightRange")?.value || "today";
  const sessions = filterByRange(DriftDockStorage.sessionsForActive(), range);
  const metrics = calculateInsights(sessions);
  $("dailySummary").textContent = dailySummary(metrics);
  const cards = $("insightCards");
  if (!cards) return;
  cards.replaceChildren();
  [
    ["Actual focus", formatMinutes(metrics.actualFocusSeconds)],
    ["Planned focus", `${metrics.plannedMinutes} min`],
    ["Sessions", String(metrics.sessions)],
    ["Completed", String(metrics.completed)],
    ["Interruptions", String(metrics.interruptions)],
    ["Most common reason", metrics.topReason || "None"],
    ["Return rate", `${metrics.returnRate}%`],
    ["Planned completed", `${metrics.plannedCompletion}%`]
  ].forEach(([label,value]) => {
    const card = document.createElement("div");
    card.className = "metric-card";
    card.innerHTML = `<span class="small">${label}</span><strong>${escapeHtml(value)}</strong>`;
    cards.append(card);
  });
  renderCharts(metrics);
}

function calculateInsights(sessions) {
  const goalCounts = { yes:0, partly:0, no:0, unsure:0 };
  const reasonCounts = {};
  let returnIntentions = 0, returns = 0, breakSeconds = 0, breakCount = 0, firstInterruptSum = 0, firstInterruptCount = 0;
  for (const record of sessions) {
    if (record.goal_achieved) goalCounts[record.goal_achieved]++;
    if (record.time_until_first_interruption_seconds != null) { firstInterruptSum += record.time_until_first_interruption_seconds; firstInterruptCount++; }
    for (const item of record.interruptions) {
      const reason = item.reason_label || item.primary_reason || "Other";
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      if (item.return_intention) returnIntentions++;
      if (item.returned) returns++;
      if (item.actual_break_seconds != null) { breakSeconds += item.actual_break_seconds; breakCount++; }
    }
  }
  const actualFocusSeconds = sessions.reduce((sum, item) => sum + item.actual_focus_seconds, 0);
  const plannedMinutes = sessions.reduce((sum, item) => sum + item.planned_duration_minutes, 0);
  const interruptions = sessions.reduce((sum, item) => sum + item.interruptions.length, 0);
  const topReason = Object.entries(reasonCounts).sort((a,b) => b[1] - a[1])[0]?.[0] || null;
  return {
    sessions:sessions.length,
    actualFocusSeconds,
    plannedMinutes,
    averageActualSeconds:sessions.length ? Math.round(actualFocusSeconds / sessions.length) : 0,
    completed:sessions.filter((item) => item.status === "completed").length,
    goalCounts,
    interruptions,
    averageInterruptions:sessions.length ? Number((interruptions / sessions.length).toFixed(1)) : 0,
    topReason,
    reasonCounts,
    averageFirstInterruption:firstInterruptCount ? Math.round(firstInterruptSum / firstInterruptCount) : null,
    returnIntentions,
    returns,
    returnRate:returnIntentions ? Math.round((returns / returnIntentions) * 100) : 0,
    averageBreakSeconds:breakCount ? Math.round(breakSeconds / breakCount) : 0,
    plannedCompletion:plannedMinutes ? Math.round((actualFocusSeconds / (plannedMinutes * 60)) * 100) : 0,
    dailyFocus:dailyFocusMap(sessions)
  };
}

function renderCharts(metrics) {
  const container = $("insightCharts");
  if (!container) return;
  container.replaceChildren();
  addBarChart(container, "Daily actual focus time", metrics.dailyFocus);
  addBarChart(container, "Interruption reasons", metrics.reasonCounts);
  addBarChart(container, "Goal achievement", metrics.goalCounts);
}

function addBarChart(container, title, values) {
  const article = document.createElement("article");
  article.className = "report-card";
  const max = Math.max(1, ...Object.values(values).map(Number));
  article.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
  const entries = Object.entries(values).filter(([,value]) => Number(value) > 0);
  if (!entries.length) article.innerHTML += `<p>No data yet.</p>`;
  entries.slice(0, 10).forEach(([label,value]) => {
    const row = document.createElement("div");
    row.className = "chart-row";
    row.innerHTML = `<span>${escapeHtml(label)}</span><div class="bar" aria-hidden="true"><span style="width:${Math.max(4, Number(value) / max * 100)}%"></span></div><strong>${Number(value)}</strong>`;
    article.append(row);
  });
  container.append(article);
}

function dailySummary(metrics) {
  if (!metrics.sessions) return "No local sessions in this range yet.";
  return `You completed ${metrics.completed} of ${metrics.sessions} focus sessions. You planned ${metrics.plannedMinutes} minutes and focused for ${Math.round(metrics.actualFocusSeconds / 60)} minutes. You recorded ${metrics.interruptions} interruptions. ${metrics.topReason ? `The most common reason was “${metrics.topReason}”. ` : ""}You returned after ${metrics.returns} of ${metrics.returnIntentions} interruptions with return intention.`;
}

function renderSettings() {
  const data = DriftDockStorage.read();
  const profile = DriftDockStorage.activeProfile(data);
  if ($("profileName")) $("profileName").value = profile.display_name;
}

function renameActiveProfile(event) {
  event.preventDefault();
  localData = DriftDockStorage.renameProfile(DriftDockStorage.read().active_profile_id, $("profileName").value);
  settingsStatus("Profile renamed.");
  renderProfileSelector(); renderHistory(); renderInsights();
}

function createLocalProfile(event) {
  event.preventDefault();
  localData = DriftDockStorage.createProfile($("newProfileName").value);
  $("newProfileName").value = "";
  settingsStatus("Local profile created.");
  renderProfileSelector(); renderRecovery(); renderHistory(); renderInsights(); renderSettings();
}

function exportActiveProfile() {
  const data = DriftDockStorage.exportProfile();
  const filename = `drift-dock-${slugify(data.profile.display_name) || "profile"}-${new Date().toISOString().slice(0,10)}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  settingsStatus(`Exported ${data.sessions.length} sessions for ${data.profile.display_name}.`);
}

async function previewImportFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    pendingImport = DriftDockStorage.importPreview(await file.text());
    $("importPreview").hidden = false;
    $("importPreview").textContent = `${pendingImport.profile_name}: ${pendingImport.session_count} sessions · ${pendingImport.date_range} · schema ${pendingImport.schema_version}`;
    $("importActions").hidden = false;
  } catch (error) {
    pendingImport = null;
    $("importPreview").hidden = false;
    $("importPreview").textContent = error.message;
    $("importActions").hidden = true;
  }
}

function applyImport(mode) {
  if (!pendingImport) return;
  if (mode === "replace" && !confirm("Replace current profile history with this import? A backup exists only in memory until you leave this page.")) return;
  const result = DriftDockStorage.importProfile(pendingImport.payload, mode);
  settingsStatus(`Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.rejected} rejected.`);
  pendingImport = null;
  $("importActions").hidden = true;
  renderHistory(); renderInsights();
}

function clearActiveProfileHistory() {
  const profile = DriftDockStorage.activeProfile();
  if (!confirm(`Clear all local session history for ${profile.display_name}?`)) return;
  DriftDockStorage.clearProfileHistory(profile.profile_id);
  settingsStatus("Current profile history cleared.");
  renderRecovery(); renderHistory(); renderInsights();
}

function deleteActiveProfile() {
  const profile = DriftDockStorage.activeProfile();
  if (!confirm(`Delete local profile ${profile.display_name} and its session history? This is not a secure account; only local browser data is affected.`)) return;
  try {
    DriftDockStorage.deleteProfile(profile.profile_id, true);
    settingsStatus("Local profile deleted.");
    renderProfileSelector(); renderRecovery(); renderHistory(); renderInsights(); renderSettings();
  } catch (error) { settingsStatus(error.message); }
}

function clearAllLocalData() {
  if (!confirm("Clear all Drift Dock local data for this browser? This will not delete unrelated browser storage or server configuration.")) return;
  DriftDockStorage.clearAll();
  settingsStatus("All Drift Dock local data cleared.");
  renderProfileSelector(); renderRecovery(); renderHistory(); renderInsights(); renderSettings();
}

function settingsStatus(message) {
  $("settingsStatus").textContent = message;
}

function filterByRange(sessions, range) {
  const now = new Date();
  const start = new Date(now);
  if (range === "today") start.setHours(0,0,0,0); else start.setDate(start.getDate() - (Number(range) - 1));
  return sessions.filter((item) => Date.parse(item.started_at || item.created_at) >= start.getTime());
}

function dailyFocusMap(sessions) {
  const map = {};
  sessions.forEach((item) => {
    const day = (item.started_at || item.created_at).slice(0, 10);
    map[day] = (map[day] || 0) + Math.round(item.actual_focus_seconds / 60);
  });
  return map;
}

function initVoiceConsent() {
  const consented = sessionStorage.getItem(VOICE_PROCESSING_CONSENT_KEY) === "true";
  $("voiceProcessingConsent").checked = consented;
  $("exitVoiceProcessingConsent").checked = consented;
  updateVoiceConsentStatus(consented);
}

function handleVoiceConsentChange(event) {
  const consented = event.target.checked;
  if (consented) {
    sessionStorage.setItem(VOICE_PROCESSING_CONSENT_KEY, "true");
  } else {
    sessionStorage.removeItem(VOICE_PROCESSING_CONSENT_KEY);
  }
  $("voiceProcessingConsent").checked = consented;
  $("exitVoiceProcessingConsent").checked = consented;
  updateVoiceConsentStatus(consented);
}

function hasVoiceProcessingConsent() {
  return $("voiceProcessingConsent")?.checked === true || $("exitVoiceProcessingConsent")?.checked === true;
}

function updateVoiceConsentStatus(consented) {
  $("voiceConsentStatus").textContent = consented ? "Voice recording is available for this browser session." : "Voice recording requires consent to the processing described above.";
  $("exitVoiceConsentStatus").textContent = consented ? "Voice recording is available for this browser session." : "Exit voice recording requires consent to the processing described above.";
  voiceFlows.forEach((flow) => disableFlowStart(flow, flow.requestActive || flow.state === "recording" || flow.state === "requesting"));
}

function setFlowStatus(flow, state, text) {
  flow.state = state;
  $(flow.statusId).dataset.state = state;
  $(flow.statusTextId).textContent = text;
}

function showFlowError(flow, message) {
  $(flow.errorId).textContent = message;
  $(flow.errorId).hidden = false;
  setFlowStatus(flow, "error", message);
}

function clearFlowError(flow) {
  $(flow.errorId).hidden = true;
  $(flow.errorId).textContent = "";
}

function disableFlowStart(flow, disabled) {
  $(flow.startId).disabled = disabled || !hasVoiceProcessingConsent();
  $(flow.mockAnalyzeId).disabled = disabled;
}

function resetVoiceControls(flow) {
  $(flow.startId).hidden = false;
  $(flow.actionsId).hidden = true;
  $(flow.timerId).hidden = true;
  disableFlowStart(flow, false);
}

function clearRecordingTimers(flow) {
  clearInterval(flow.clock);
  clearTimeout(flow.maxTimer);
  flow.clock = null;
  flow.maxTimer = null;
}

function releaseMicrophone(flow) {
  flow.stream?.getTracks().forEach((track) => track.stop());
  flow.stream = null;
}

function ensureDurationOption(minutes) {
  let option = [...$("duration").options].find((item) => Number(item.value) === minutes);
  if (!option) {
    option = new Option(`${minutes} minutes`, String(minutes));
    $("duration").add(option);
  }
  $("duration").value = String(minutes);
}

function ensureReturnTimeOption(minutes) {
  const label = `${minutes} minutes`;
  let option = [...$("returnTime").options].find((item) => item.textContent === label || Number(item.value) === minutes);
  if (!option) {
    option = new Option(label, label);
    $("returnTime").add(option, $("returnTime").options[$("returnTime").options.length - 1]);
  }
  $("returnTime").value = label;
}

function resetForRecording() {
  showScreen("start");
  clearFlowError(focusVoice);
  setFlowStatus(focusVoice, "idle", "Ready to record again · up to 90 seconds");
  $(focusVoice.startId).focus();
}

function returnToManual() {
  showScreen("start");
  clearFlowError(focusVoice);
  setFlowStatus(focusVoice, "idle", "Voice plan cancelled. Manual input is ready.");
  $("task").focus();
}

function extensionFor(type) {
  const mime = String(type).split(";", 1)[0].trim().toLowerCase();
  const extensions = { "audio/webm":"webm", "audio/ogg":"ogg", "audio/wav":"wav", "audio/x-wav":"wav", "audio/mpeg":"mp3", "audio/mp4":"mp4", "audio/m4a":"m4a", "audio/x-m4a":"m4a" };
  return `recording.${extensions[mime] || "webm"}`;
}

function parseReturnMinutes(value) {
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function friendlyReason(reason) {
  return {
    too_difficult: "The task feels difficult",
    tired: "You are mentally tired",
    bored: "The task feels boring",
    urgent_external_reason: "Something external needs attention",
    short_break: "You need a short break",
    unclear_task: "The task feels unclear",
    emotional_resistance: "There is emotional resistance",
    external_dependency: "You are waiting on something external",
    environment_problem: "Your environment is getting in the way",
    other: "Something else is making you leave"
  }[reason] || "";
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}`;
}

function formatMinutes(seconds = 0) {
  const minutes = Math.round(Number(seconds || 0) / 60);
  return `${minutes} min`;
}

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(date); target.setHours(0,0,0,0);
  if (target.getTime() === today.getTime()) return "Today";
  return date.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}

function timeLabel(value) {
  return new Date(value).toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[char]));
}
