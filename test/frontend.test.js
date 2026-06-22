import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
const appSource = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function createBrowser({ microphoneError, onRequest } = {}) {
  const dom = new JSDOM(html, { runScripts:"outside-only", url:"http://localhost:3000" });
  const { window } = dom;
  window.scrollTo = () => {};
  window.fetch = async (url, options) => {
    if (String(url).includes("/api/config")) return { ok:true, json:async () => ({ voiceFocusMockMode:true }) };
    onRequest?.(url, options);
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
    constructor(_stream, options = {}) { super(); this.state="inactive"; this.mimeType=options.mimeType || "audio/webm"; }
    start() { this.state="recording"; }
    stop() {
      this.state="inactive";
      const dataEvent = new window.Event("dataavailable");
      Object.defineProperty(dataEvent, "data", { value:new window.Blob(["browser audio"], { type:this.mimeType }) });
      this.dispatchEvent(dataEvent);
      queueMicrotask(() => this.dispatchEvent(new window.Event("stop")));
    }
  }
  window.MediaRecorder = FakeMediaRecorder;
  window.eval(appSource);
  await tick();
  return dom;
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
  document.querySelector("#recordButton").click(); await tick();
  assert.match(document.querySelector("#voiceError").textContent, /permission was denied/i);
  assert.equal(document.querySelector("#manualSubmitButton").disabled, false);
  dom.window.close();
});

test("cancels an active recording without submitting it", async () => {
  const dom = await createBrowser(); const { document } = dom.window;
  document.querySelector("#recordButton").click(); await tick();
  assert.equal(document.querySelector("#voiceStatus").dataset.state, "recording");
  document.querySelector("#cancelRecordingButton").click(); await tick();
  assert.match(document.querySelector("#voiceStatusText").textContent, /cancelled/i);
  assert.equal(document.querySelector("#recordButton").hidden, false);
  dom.window.close();
});

test("browser recording submits codec MIME type with an explicit matching filename", async () => {
  let upload;
  const dom = await createBrowser({ onRequest:(_url, options) => {
    const file = options.body.get("audio");
    upload = { name:file.name, type:file.type, size:file.size };
  } });
  const { document } = dom.window;
  document.querySelector("#recordButton").click(); await tick();
  document.querySelector("#stopButton").click(); await tick(); await tick();
  assert.equal(upload.name, "recording.webm");
  assert.equal(upload.type, "audio/webm;codecs=opus");
  assert.ok(upload.size > 0);
  dom.window.close();
});
