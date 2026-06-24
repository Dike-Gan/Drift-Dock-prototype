import { validateExitAnchor } from "../schemas/exitAnchorSchema.js";

export function createMockExitAnchor(transcript) {
  const text = transcript.trim();
  const durationMatch = text.match(/\b(\d{1,3})\s*(?:minute|minutes|min)\b/i) || wordDuration(text);
  const duration = durationMatch ? Number(durationMatch[1]) : null;
  const lower = text.toLowerCase();
  const reason = inferPrimaryReason(lower);
  const sentences = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
  const obstacleSentence = sentences.find((sentence) => /\b(stuck|unclear|difficult|hard|tired|bored|waiting|noisy|confus|don't know|do not know)\b/i.test(sentence)) || sentences[0] || null;
  const nextStepSentence = sentences.find((sentence) => /\b(when i (?:come back|return)|i should|next|first)\b/i.test(sentence));
  const hasVagueDuration = /\b(few|couple|short|little)\s+(?:minute|minutes|break)\b/i.test(text) && !duration;
  const multipleReasons = [/\bstuck|unclear|difficult|hard\b/i, /\btired\b/i, /\bbored\b/i, /\burgent\b/i, /\bwaiting\b/i].filter((pattern) => pattern.test(text)).length > 1;

  return validateExitAnchor({
    primary_reason: reason,
    reason_label: labelForReason(reason),
    user_explanation: obstacleSentence ? obstacleSentence.slice(0, 260) : null,
    where_stopped: inferWhereStopped(sentences),
    current_obstacle: obstacleSentence ? obstacleSentence.slice(0, 260) : null,
    next_tiny_step: nextStepSentence ? cleanupNextStep(nextStepSentence) : "Write one question the next section should answer.",
    planned_break_minutes: duration && duration <= 180 ? duration : null,
    return_intention: /\b(come back|return|when i'?m back|after the break)\b/i.test(text) ? true : /\b(done|end|quit|give up|stop completely)\b/i.test(text) ? false : null,
    success_condition_for_return: duration ? `Return after ${duration} minutes and start with the next tiny step.` : null,
    needs_confirmation: [
      ...(hasVagueDuration ? ["Confirm the intended break duration."] : []),
      ...(multipleReasons ? ["Confirm the main reason for leaving."] : []),
      ...(!nextStepSentence ? ["Confirm the next tiny return step."] : [])
    ]
  });
}

function inferPrimaryReason(text) {
  if (/\burgent|emergency|external reason\b/.test(text)) return "urgent_external_reason";
  if (/\btired|exhausted|sleepy\b/.test(text)) return "tired";
  if (/\bbored|boring\b/.test(text)) return "bored";
  if (/\bshort break|break\b/.test(text)) return "short_break";
  if (/\bunclear|confus|don't know|do not know\b/.test(text)) return "unclear_task";
  if (/\bstuck|difficult|hard\b/.test(text)) return "too_difficult";
  if (/\bwaiting|blocked by|dependency\b/.test(text)) return "external_dependency";
  if (/\bnoisy|environment|internet|wifi\b/.test(text)) return "environment_problem";
  if (/\banxious|avoid|resistance|overwhelmed\b/.test(text)) return "emotional_resistance";
  return text ? "other" : null;
}

function labelForReason(reason) {
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
  }[reason] || null;
}

function inferWhereStopped(sentences) {
  const sentence = sentences.find((item) => /\b(working on|currently|stopped|section|slide|paragraph|draft)\b/i.test(item));
  return sentence ? sentence.slice(0, 220) : null;
}

function cleanupNextStep(sentence) {
  return sentence.replace(/^when i (?:come back|return),?\s*/i, "").replace(/^i should\s*/i, "").slice(0, 220);
}

function wordDuration(text) {
  const words = { five:5, ten:10, fifteen:15, twenty:20, "twenty-five":25, thirty:30 };
  const match = text.toLowerCase().match(/\b(five|ten|fifteen|twenty|twenty-five|thirty)[ -]minute/);
  return match ? [match[0], words[match[1]]] : null;
}
