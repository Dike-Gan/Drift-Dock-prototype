import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
const appSource = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const consentKey = "driftDockVoiceProcessingConsent";

async function createBrowser({ microphoneError } = {}) {
  const dom = new JSDOM(html, { runScripts:"outside-only", url:"http://localhost:3000" });
  const { window } = dom;
  window.scrollTo = () => {};
  window.fetch = async (url) => {
    if (String(url).includes("/api/config")) return { ok:true, json:async () => ({ voiceFocusMockMode:true }) };
    return { ok:true, json:async () => ({
      success:true, mockMode:true,
      transcript:"Prepare the seminar presentation and define its structure for 40 minutes.",
      focusPlan:{ task_title:"Prepare the seminar presentation", session_goal:"Define the presentation structure", duration_minutes:40, broader_goal:"Make the report understandable", current_problem:null, task_context:"Seminar presentation", success_criteria:["Structure is defined"], suggested_first_step:"List the main sections", uncertainties:[], needs_confirmation:[] }
    }) };
  };
  const stream = { getTracks:() => [{ stop(){} }] };
  Object.defineProperty(window.navigator, "mediaDevices", { configurable:true, value:{ getUserMedia:async () => { if (microphoneError) throw microphoneError; return stream; } } });
  class FakeMediaRecorder extends window.EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state="inactive"; this.mimeType="audio/webm"; }
    start() { this.state="recording"; }
    stop() { this.state="inactive"; queueMicrotask(() => this.dispatchEvent(new window.Event("stop"))); }
  }
  window.MediaRecorder = FakeMediaRecorder;
  window.eval(appSource);
  await tick();
  return dom;
}

function grantVoiceConsent(document) {
  const checkbox = document.querySelector("#voiceProcessingConsent");
  checkbox.checked = true;
  checkbox.dispatchEvent(new document.defaultView.Event("change", { bubbles:true }));
}

test("preserves the complete manual focus, exit, return, and report flow", async () => {
  const dom = await createBrowser(); const { document } = dom.window;
  document.querySelector("#task").value = "Prepare seminar presentation";
  document.querySelector("#goal").value = "Draft the structure";
  document.querySelector("#duration").value = "25";
  document.querySelector("#manualForm").dispatchEvent(new dom.window.Event("submit", { bubbles:true, cancelable:true }));
  assert.ok(document.querySelector("#focus").classList.contains("active"));
  assert.equal(document.querySelector("#showTask").textContent, "Prepare seminar presentation");
  document.querySelector('[data-screen="exit"]').click();
  document.querySelector('[data-reason="Too difficult"]').click();
  assert.ok(document.querySelector("#break").classList.contains("active"));
  document.querySelector("#whereStopped").value = "At slide 4";
  document.querySelector("#startBreakButton").click(); document.querySelector("#returnButton").click();
  assert.equal(document.querySelector("#returnStopped").textContent, "At slide 4");
  document.querySelector("#return .choice [data-screen=\"focus\"]").click();
  document.querySelector("#finishSessionButton").click();
  assert.ok(document.querySelector("#report").classList.contains("active"));
  assert.equal(document.querySelector("#reportInterruptions").textContent, "1");
  dom.window.close();
});

test("runs the mock voice confirmation flow and supports a non-preset duration", async () => {
  const dom = await createBrowser(); const { document } = dom.window;
  document.querySelector("#mockTranscript").value = "Prepare the seminar presentation for 40 minutes.";
  document.querySelector("#analyzeMockButton").click(); await tick(); await tick();
  assert.ok(document.querySelector("#confirmation").classList.contains("active"));
  assert.equal(document.querySelector("#confirmDuration").value, "40");
  document.querySelector("#confirmationForm").dispatchEvent(new dom.window.Event("submit", { bubbles:true, cancelable:true }));
  assert.ok(document.querySelector("#focus").classList.contains("active"));
  assert.equal(document.querySelector("#duration").value, "40");
  assert.equal(document.querySelector("#showFirstStep").textContent, "List the main sections");
  document.querySelector("#finishSessionButton").click(); dom.window.close();
});

test("shows a human-readable microphone denial and keeps manual input available", async () => {
  const denial = new Error("denied"); denial.name = "NotAllowedError";
  const dom = await createBrowser({ microphoneError:denial }); const { document } = dom.window;
  grantVoiceConsent(document);
  document.querySelector("#recordButton").click(); await tick();
  assert.match(document.querySelector("#voiceError").textContent, /permission was denied/i);
  assert.equal(document.querySelector("#manualSubmitButton").disabled, false);
  dom.window.close();
});

test("cancels an active recording without submitting it", async () => {
  const dom = await createBrowser(); const { document } = dom.window;
  grantVoiceConsent(document);
  document.querySelector("#recordButton").click(); await tick();
  assert.equal(document.querySelector("#voiceStatus").dataset.state, "recording");
  document.querySelector("#cancelRecordingButton").click(); await tick();
  assert.match(document.querySelector("#voiceStatusText").textContent, /cancelled/i);
  assert.equal(document.querySelector("#recordButton").hidden, false);
  dom.window.close();
});

test("keeps voice recording disabled until session consent is checked", async () => {
  const dom = await createBrowser(); const { document } = dom.window;
  const recordButton = document.querySelector("#recordButton");
  const checkbox = document.querySelector("#voiceProcessingConsent");
  assert.equal(checkbox.checked, false);
  assert.equal(recordButton.disabled, true);
  assert.match(document.querySelector("#voiceConsentStatus").textContent, /requires consent/i);
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event("change", { bubbles:true }));
  assert.equal(recordButton.disabled, false);
  assert.match(document.querySelector("#voiceConsentStatus").textContent, /available/i);
  dom.window.close();
});

test("unchecking consent disables voice recording again", async () => {
  const dom = await createBrowser(); const { document } = dom.window;
  const recordButton = document.querySelector("#recordButton");
  const checkbox = document.querySelector("#voiceProcessingConsent");
  grantVoiceConsent(document);
  assert.equal(recordButton.disabled, false);
  checkbox.checked = false;
  checkbox.dispatchEvent(new dom.window.Event("change", { bubbles:true }));
  assert.equal(recordButton.disabled, true);
  assert.match(document.querySelector("#voiceConsentStatus").textContent, /requires consent/i);
  dom.window.close();
});

test("manual input remains usable without voice-processing consent", async () => {
  const dom = await createBrowser(); const { document } = dom.window;
  assert.equal(document.querySelector("#recordButton").disabled, true);
  assert.equal(document.querySelector("#manualSubmitButton").disabled, false);
  document.querySelector("#task").value = "Write a test plan";
  document.querySelector("#goal").value = "Draft the privacy cases";
  document.querySelector("#manualForm").dispatchEvent(new dom.window.Event("submit", { bubbles:true, cancelable:true }));
  assert.ok(document.querySelector("#focus").classList.contains("active"));
  assert.equal(document.querySelector("#showTask").textContent, "Write a test plan");
  dom.window.close();
});

test("voice consent is stored only in sessionStorage", async () => {
  const dom = await createBrowser(); const { document, sessionStorage, localStorage } = dom.window;
  grantVoiceConsent(document);
  assert.equal(sessionStorage.getItem(consentKey), "true");
  assert.equal(localStorage.getItem(consentKey), null);
  document.querySelector("#voiceProcessingConsent").checked = false;
  document.querySelector("#voiceProcessingConsent").dispatchEvent(new dom.window.Event("change", { bubbles:true }));
  assert.equal(sessionStorage.getItem(consentKey), null);
  assert.equal(localStorage.getItem(consentKey), null);
  dom.window.close();
});

test("privacy notice and accessible disclosure are present in the voice card", async () => {
  const dom = await createBrowser(); const { document } = dom.window;
  const notice = document.querySelector(".privacy-note");
  const disclosure = document.querySelector(".privacy-details");
  const checkbox = document.querySelector("#voiceProcessingConsent");
  assert.match(notice.textContent, /Your recording and transcript are sent to OpenAI/i);
  assert.match(document.querySelector(".prototype-label").textContent, /User testing prototype/i);
  assert.equal(disclosure.tagName, "DETAILS");
  assert.match(disclosure.querySelector("summary").textContent, /How your data is processed/i);
  assert.match(disclosure.textContent, /not used to train OpenAI models unless/i);
  assert.equal(document.querySelector("label[for='voiceProcessingConsent']").textContent, "I understand and agree to the processing described above.");
  assert.equal(checkbox.checked, false);
  dom.window.close();
});
