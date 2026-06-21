const MAX_RECORDING_SECONDS = 90;

// Future-ready session record. This version stays in browser memory only.
const session = {
  session_id: crypto.randomUUID?.() || String(Date.now()), created_at: new Date().toISOString(),
  task_title: "", session_goal: "", planned_duration_minutes: 45, actual_focus_duration_seconds: null,
  broader_goal: "", current_problem: "", task_context: "", success_criteria: [], suggested_first_step: "",
  uncertainties: [], raw_transcript: "", interruptions: [], return_anchors: [], goal_achieved: null,
  completion_status: "", secondsLeft: 2700, timer: null, focusStartedAt: null
};

const voice = { state:"idle", stream:null, recorder:null, chunks:[], startedAt:0, clock:null, maxTimer:null, requestActive:false, cancelled:false, mockMode:false };
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    voice.mockMode = Boolean(config.voiceFocusMockMode);
    $("voiceModeBadge").hidden = !voice.mockMode;
    $("mockControls").hidden = !voice.mockMode;
    if (voice.mockMode) setVoiceStatus("idle", "Mock mode is active — no OpenAI request will be made.");
  } catch { showVoiceError("The backend is unavailable. You can still use manual input."); }
});

function bindEvents() {
  $("manualForm").addEventListener("submit", (event) => { event.preventDefault(); startManualSession(); });
  $("recordButton").addEventListener("click", beginRecording);
  $("stopButton").addEventListener("click", () => stopRecording(false));
  $("cancelRecordingButton").addEventListener("click", cancelRecording);
  $("analyzeMockButton").addEventListener("click", analyzeMockTranscript);
  $("confirmationForm").addEventListener("submit", confirmVoicePlan);
  $("recordAgainButton").addEventListener("click", resetForRecording);
  $("cancelVoiceButton").addEventListener("click", returnToManual);
  document.addEventListener("click", (event) => { const id = event.target.dataset.screen; if (id) showScreen(id); });
  $("reasonChoices").addEventListener("click", (event) => { if (event.target.dataset.reason) selectReason(event.target.dataset.reason); });
  $("finishSessionButton").addEventListener("click", completeSession);
  $("startBreakButton").addEventListener("click", startBreak);
  $("endBecauseLeftButton").addEventListener("click", completeSession);
  $("returnButton").addEventListener("click", showReturn);
  $("smallerStepButton").addEventListener("click", generateSmallerStep);
  $("resetButton").addEventListener("click", () => location.reload());
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  $(id)?.querySelector("h1,h2")?.focus?.({ preventScroll:true });
  window.scrollTo({ top:0, behavior:"smooth" });
}

async function beginRecording() {
  if (voice.requestActive || voice.state === "recording") return;
  clearVoiceError();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return showVoiceError("This browser does not support voice recording. Please use manual input or a current browser.");
  }
  setVoiceStatus("requesting", "Requesting microphone permission…");
  disableVoiceStart(true);
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
    voice.chunks = []; voice.cancelled = false;
    voice.recorder = preferred ? new MediaRecorder(voice.stream, { mimeType:preferred }) : new MediaRecorder(voice.stream);
    voice.recorder.addEventListener("dataavailable", (event) => { if (event.data.size) voice.chunks.push(event.data); });
    voice.recorder.addEventListener("stop", handleRecordingStopped, { once:true });
    voice.recorder.start(250); voice.startedAt = Date.now();
    voice.clock = setInterval(updateRecordingClock, 250);
    voice.maxTimer = setTimeout(() => stopRecording(false, true), MAX_RECORDING_SECONDS * 1000);
    $("recordButton").hidden = true; $("recordingActions").hidden = false; $("recordingTimer").hidden = false;
    setVoiceStatus("recording", "Recording — speak naturally. Stop when your plan is clear."); updateRecordingClock();
  } catch (error) {
    disableVoiceStart(false); setVoiceStatus("error", "Microphone access failed.");
    const message = error.name === "NotAllowedError" ? "Microphone permission was denied. Allow access in browser settings or use manual input." : error.name === "NotFoundError" ? "No microphone was found. Connect one or use manual input." : "The microphone could not be started. Please try again or use manual input.";
    showVoiceError(message); releaseMicrophone();
  }
}

function updateRecordingClock() { const seconds = Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - voice.startedAt) / 1000)); $("recordingTimer").textContent = formatTime(seconds); }
function stopRecording(cancelled, reachedLimit = false) { if (!voice.recorder || voice.recorder.state === "inactive") return; voice.cancelled = cancelled; if (reachedLimit) setVoiceStatus("recording", "Maximum recording length reached. Processing your plan…"); voice.recorder.stop(); }
function cancelRecording() { stopRecording(true); resetVoiceControls(); setVoiceStatus("idle", "Recording cancelled. Ready to try again."); }

async function handleRecordingStopped() {
  clearRecordingTimers(); releaseMicrophone();
  const blob = new Blob(voice.chunks, { type:voice.recorder?.mimeType || "audio/webm" }); voice.chunks = [];
  if (voice.cancelled) return;
  resetVoiceControls();
  if (!blob.size) return showVoiceError("The recording was empty. Please try again.");
  await submitVoicePlan(blob);
}

async function analyzeMockTranscript() {
  if (!voice.mockMode || voice.requestActive) return;
  const transcript = $("mockTranscript").value.trim();
  if (!transcript) return showVoiceError("Enter a mock transcript to test the voice flow.");
  await submitVoicePlan(null, transcript);
}

async function submitVoicePlan(blob, mockTranscript = "") {
  if (voice.requestActive) return showVoiceError("A focus plan request is already in progress.");
  voice.requestActive = true; disableVoiceStart(true); clearVoiceError();
  const form = new FormData();
  if (blob) form.append("audio", blob, extensionFor(blob.type));
  if (mockTranscript) form.append("mockTranscript", mockTranscript);
  setVoiceStatus("uploading", "Uploading recording securely…");
  const transcribingHint = setTimeout(() => setVoiceStatus("transcribing", "Transcribing your plan…"), 500);
  const analyzingHint = setTimeout(() => setVoiceStatus("analyzing", "Turning the transcript into a focus plan…"), 1600);
  try {
    const response = await fetch("/api/voice/focus-plan", { method:"POST", body:form });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error?.message || "The backend could not process the recording.");
    populateConfirmation(result.transcript, result.focusPlan);
    setVoiceStatus("success", result.mockMode ? "Mock focus plan ready for review." : "Focus plan ready for review.");
    showScreen("confirmation");
  } catch (error) {
    setVoiceStatus("error", "Voice plan failed.");
    showVoiceError(error.message === "Failed to fetch" ? "The backend is unavailable. Please try again or use manual input." : error.message);
  } finally {
    clearTimeout(transcribingHint); clearTimeout(analyzingHint); voice.requestActive = false; disableVoiceStart(false);
  }
}

function populateConfirmation(transcript, plan) {
  session.raw_transcript = transcript; $("rawTranscript").textContent = transcript;
  $("confirmTask").value = plan.task_title || ""; $("confirmGoal").value = plan.session_goal || "";
  $("confirmDuration").value = plan.duration_minutes || ""; $("confirmFirstStep").value = plan.suggested_first_step || "";
  session.broader_goal = plan.broader_goal || ""; session.current_problem = plan.current_problem || ""; session.task_context = plan.task_context || "";
  session.success_criteria = plan.success_criteria || []; session.uncertainties = plan.uncertainties || [];
  const fields = [["Broader goal",plan.broader_goal],["Current problem",plan.current_problem],["Task context",plan.task_context],["Success criteria",plan.success_criteria],["Uncertainties",plan.uncertainties],["Needs confirmation",plan.needs_confirmation]];
  const content = $("contextContent"); content.replaceChildren(); let count = 0; const list = document.createElement("dl");
  for (const [label,value] of fields) { const values = Array.isArray(value) ? value : value ? [value] : []; if (!values.length) continue; count++; const dt=document.createElement("dt"); dt.textContent=label; const dd=document.createElement("dd"); if(values.length===1){dd.textContent=values[0];}else{const ul=document.createElement("ul"); values.forEach((item)=>{const li=document.createElement("li");li.textContent=item;ul.append(li);});dd.append(ul);} list.append(dt,dd); }
  content.append(list); $("additionalContext").hidden = count === 0;
}

function confirmVoicePlan(event) {
  event.preventDefault();
  const task=$("confirmTask").value.trim(), goal=$("confirmGoal").value.trim(), duration=Number($("confirmDuration").value);
  if (!task || !goal) return;
  if (duration && (duration < 1 || duration > 180)) return showVoiceError("Focus duration must be between 1 and 180 minutes.");
  $("task").value=task; $("goal").value=goal; if (duration) ensureDurationOption(duration);
  session.suggested_first_step=$("confirmFirstStep").value.trim(); startSession(task,goal,duration || 45);
}

function startManualSession() { if (voice.requestActive || voice.state === "recording" || voice.state === "requesting") return showVoiceError("Finish or cancel the active voice request before starting manually."); session.raw_transcript=""; session.suggested_first_step=""; startSession($("task").value.trim() || "Untitled task", $("goal").value.trim() || "Make progress", Number($("duration").value)); }
function startSession(task,goal,duration) { session.task_title=task; session.session_goal=goal; session.planned_duration_minutes=duration; session.secondsLeft=duration*60; session.focusStartedAt=Date.now(); session.completion_status="in_progress"; $("showTask").textContent=task; $("showGoal").textContent=goal; $("showFirstStep").textContent=session.suggested_first_step; $("firstStepCard").hidden=!session.suggested_first_step; updateTimer(); if(session.timer)clearInterval(session.timer); session.timer=setInterval(()=>{if(session.secondsLeft>0){session.secondsLeft--;updateTimer();}},1000); showScreen("focus"); }
function updateTimer(){const minutes=Math.floor(session.secondsLeft/60),seconds=session.secondsLeft%60;$("timeLeft").textContent=`${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;const used=1-session.secondsLeft/(session.planned_duration_minutes*60);const degrees=Math.max(0,Math.min(360,used*360));$("timerCircle").style.background=`conic-gradient(var(--primary) ${degrees}deg, var(--primary-light) ${degrees}deg)`;}
function selectReason(reason){session.interruptions.push({created_at:new Date().toISOString(),reason});$("reasonText").textContent=reason;if(reason==="Urgent external reason"){$("whereStopped").value="I had to leave because something else became more urgent.";$("nextStep").value="When I return, first check what was open and decide whether to continue or reschedule.";}else if(reason==="Too difficult"){$("nextStep").value="Make the next step smaller: work only for 2 minutes on the easiest part.";}else if(reason==="Too tired"){$("nextStep").value="After the break, do one low-energy step, such as reading one paragraph or organizing one slide.";}showScreen("break");}
function startBreak(){const anchor={created_at:new Date().toISOString(),where_stopped:$("whereStopped").value.trim(),next_step:$("nextStep").value.trim(),return_plan:$("returnTime").value};session.return_anchors.push(anchor);$("returnPlan").textContent=anchor.return_plan;showScreen("onbreak");}
function showReturn(){const anchor=session.return_anchors.at(-1)||{};$("returnStopped").textContent=anchor.where_stopped||"No note added.";$("returnNext").textContent=anchor.next_step||"Open the task and do one tiny step for 2 minutes.";$("aiBox").hidden=true;showScreen("return");}
function generateSmallerStep(){$("aiSuggestion").textContent="For the next 2 minutes: open the task, look only at the last sentence or slide, and write one imperfect bullet point. Stop after that if needed.";$("aiBox").hidden=false;}
function completeSession(){if(session.timer)clearInterval(session.timer);session.actual_focus_duration_seconds=session.focusStartedAt?Math.max(0,Math.floor((Date.now()-session.focusStartedAt)/1000)):null;session.completion_status="completed";$("reportTask").textContent=session.task_title||"Untitled task";$("reportInterruptions").textContent=String(session.interruptions.length);$("reportReason").textContent=session.interruptions.at(-1)?.reason||"No interruption recorded";showScreen("report");}

function ensureDurationOption(minutes){let option=[...$("duration").options].find((item)=>Number(item.value)===minutes);if(!option){option=new Option(`${minutes} minutes`,String(minutes));$("duration").add(option);}$("duration").value=String(minutes);}
function resetForRecording(){showScreen("start");clearVoiceError();setVoiceStatus("idle","Ready to record again · up to 90 seconds");$("recordButton").focus();}
function returnToManual(){showScreen("start");clearVoiceError();setVoiceStatus("idle","Voice plan cancelled. Manual input is ready.");$("task").focus();}
function setVoiceStatus(state,text){voice.state=state;$("voiceStatus").dataset.state=state;$("voiceStatusText").textContent=text;}
function showVoiceError(message){$("voiceError").textContent=message;$("voiceError").hidden=false;setVoiceStatus("error",message);}
function clearVoiceError(){$("voiceError").hidden=true;$("voiceError").textContent="";}
function disableVoiceStart(disabled){$("recordButton").disabled=disabled;$("analyzeMockButton").disabled=disabled;$("manualSubmitButton").disabled=disabled;}
function resetVoiceControls(){$("recordButton").hidden=false;$("recordingActions").hidden=true;$("recordingTimer").hidden=true;disableVoiceStart(false);}
function clearRecordingTimers(){clearInterval(voice.clock);clearTimeout(voice.maxTimer);voice.clock=null;voice.maxTimer=null;}
function releaseMicrophone(){voice.stream?.getTracks().forEach((track)=>track.stop());voice.stream=null;}
function extensionFor(type){if(type.includes("ogg"))return"recording.ogg";if(type.includes("mp4"))return"recording.m4a";return"recording.webm";}
function formatTime(seconds){return`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;}
