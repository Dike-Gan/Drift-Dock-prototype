const MAX_RECORDING_SECONDS = 90;
const VOICE_PROCESSING_CONSENT_KEY = "driftDockVoiceProcessingConsent";

// Future-ready session record. This version stays in browser memory only.
// Interruption objects are shaped for a future database table but remain local in this prototype.
const session = {
  session_id: crypto.randomUUID?.() || String(Date.now()),
  created_at: new Date().toISOString(),
  task_title: "",
  session_goal: "",
  planned_duration_minutes: 45,
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
  breakStartedAt: null,
  pendingExitAnchor: null
};

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

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
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
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  $(id)?.querySelector("h1,h2")?.focus?.({ preventScroll:true });
  window.scrollTo({ top:0, behavior:"smooth" });
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
  session.task_title = task;
  session.session_goal = goal;
  session.planned_duration_minutes = duration;
  session.secondsLeft = duration * 60;
  session.focusStartedAt = Date.now();
  session.completion_status = "in_progress";
  $("showTask").textContent = task;
  $("showGoal").textContent = goal;
  $("showFirstStep").textContent = session.suggested_first_step;
  $("firstStepCard").hidden = !session.suggested_first_step;
  updateTimer();
  if (session.timer) clearInterval(session.timer);
  session.timer = setInterval(() => { if (session.secondsLeft > 0) { session.secondsLeft--; updateTimer(); } }, 1000);
  showScreen("focus");
}

function updateTimer() {
  const minutes = Math.floor(session.secondsLeft / 60);
  const seconds = session.secondsLeft % 60;
  $("timeLeft").textContent = `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
  const used = 1 - session.secondsLeft / (session.planned_duration_minutes * 60);
  const degrees = Math.max(0, Math.min(360, used * 360));
  $("timerCircle").style.background = `conic-gradient(var(--primary) ${degrees}deg, var(--primary-light) ${degrees}deg)`;
}

function selectReason(reason) {
  const interruption = appendInterruption({
    source: "quick_reason",
    primary_reason: reasonMap[reason] || "other",
    reason_label: reason,
    return_intention: true
  });
  session.active_interruption_id = interruption.interruption_id;
  $("reasonText").textContent = reason;
  if (reason === "Urgent external reason") {
    $("whereStopped").value = "I had to leave because something else became more urgent.";
    $("nextStep").value = "When I return, first check what was open and decide whether to continue or reschedule.";
  } else if (reason === "Too difficult") {
    $("nextStep").value = "Make the next step smaller: work only for 2 minutes on the easiest part.";
  } else if (reason === "Too tired") {
    $("nextStep").value = "After the break, do one low-energy step, such as reading one paragraph or organizing one slide.";
  }
  showScreen("break");
}

function startBreak() {
  const anchor = {
    created_at: new Date().toISOString(),
    where_stopped: $("whereStopped").value.trim(),
    next_step: $("nextStep").value.trim(),
    return_plan: $("returnTime").value
  };
  session.return_anchors.push(anchor);
  session.breakStartedAt = Date.now();
  updateActiveInterruption({
    where_stopped: anchor.where_stopped || null,
    next_tiny_step: anchor.next_step || null,
    planned_break_minutes: parseReturnMinutes(anchor.return_plan),
    returned: false
  });
  $("returnPlan").textContent = anchor.return_plan;
  showScreen("onbreak");
}

function showReturn() {
  const anchor = session.return_anchors.at(-1) || {};
  updateActiveInterruption({
    returned: true,
    actual_break_seconds: session.breakStartedAt ? Math.max(0, Math.floor((Date.now() - session.breakStartedAt) / 1000)) : null
  });
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
  if (session.timer) clearInterval(session.timer);
  session.actual_focus_duration_seconds = session.focusStartedAt ? Math.max(0, Math.floor((Date.now() - session.focusStartedAt) / 1000)) : null;
  session.completion_status = "completed";
  $("reportTask").textContent = session.task_title || "Untitled task";
  $("reportInterruptions").textContent = String(session.interruptions.length);
  $("reportReason").textContent = session.interruptions.at(-1)?.reason_label || session.interruptions.at(-1)?.reason || "No interruption recorded";
  showScreen("report");
}

function appendInterruption(values) {
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
  return interruption;
}

function updateActiveInterruption(values) {
  const interruption = session.interruptions.find((item) => item.interruption_id === session.active_interruption_id);
  if (interruption) Object.assign(interruption, values);
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
