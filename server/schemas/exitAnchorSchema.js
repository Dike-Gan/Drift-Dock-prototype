import { z } from "zod";

const nullableText = z.string().trim().min(1).nullable();

export const exitReasonEnum = z.enum([
  "too_difficult",
  "tired",
  "bored",
  "urgent_external_reason",
  "short_break",
  "unclear_task",
  "emotional_resistance",
  "external_dependency",
  "environment_problem",
  "other"
]);

export const exitAnchorSchema = z.object({
  primary_reason: exitReasonEnum.nullable(),
  reason_label: nullableText,
  user_explanation: nullableText,
  where_stopped: nullableText,
  current_obstacle: nullableText,
  next_tiny_step: nullableText,
  planned_break_minutes: z.number().int().min(1).max(180).nullable(),
  return_intention: z.boolean().nullable(),
  success_condition_for_return: nullableText,
  needs_confirmation: z.array(z.string().trim().min(1)).max(10)
}).strict();

export function validateExitAnchor(value) {
  return exitAnchorSchema.parse(value);
}
