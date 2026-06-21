import { z } from "zod";

const nullableText = z.string().trim().min(1).nullable();

export const focusPlanSchema = z.object({
  task_title: nullableText,
  session_goal: nullableText,
  duration_minutes: z.number().int().min(1).max(180).nullable(),
  broader_goal: nullableText,
  current_problem: nullableText,
  task_context: nullableText,
  success_criteria: z.array(z.string().trim().min(1)).max(10),
  suggested_first_step: nullableText,
  uncertainties: z.array(z.string().trim().min(1)).max(10),
  needs_confirmation: z.array(z.string().trim().min(1)).max(10)
}).strict();

export function validateFocusPlan(value) {
  return focusPlanSchema.parse(value);
}
