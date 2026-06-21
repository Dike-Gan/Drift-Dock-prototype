import { validateFocusPlan } from "../schemas/focusPlanSchema.js";

export function createMockFocusPlan(transcript) {
  const text = transcript.trim();
  const durationMatch = text.match(/\b(\d{1,3})\s*(?:minute|minutes|min)\b/i);
  const duration = durationMatch ? Number(durationMatch[1]) : null;
  const sentenceParts = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
  const hasCompetingTasks = /\b(and also|either|or another|several tasks|multiple tasks)\b/i.test(text);
  const firstSentence = sentenceParts[0] || null;
  const goalSentence = sentenceParts.find((sentence) => /\b(want to|need to|goal|during this|session)\b/i.test(sentence)) || firstSentence;

  return validateFocusPlan({
    task_title: firstSentence ? firstSentence.slice(0, 140) : null,
    session_goal: goalSentence ? goalSentence.slice(0, 220) : null,
    duration_minutes: duration && duration <= 180 ? duration : null,
    broader_goal: null,
    current_problem: /\b(unclear|difficult|problem|unsure|confus)/i.test(text) ? "The transcript mentions an unresolved difficulty." : null,
    task_context: sentenceParts.length > 1 ? sentenceParts.slice(1).join(". ").slice(0, 400) : null,
    success_criteria: goalSentence ? ["Complete the stated session goal"] : [],
    suggested_first_step: firstSentence ? "Open the task and write one rough first step." : null,
    uncertainties: [],
    needs_confirmation: hasCompetingTasks ? ["Confirm which task is the current priority."] : []
  });
}
