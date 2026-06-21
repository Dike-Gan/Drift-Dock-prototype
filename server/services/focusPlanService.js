import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { focusPlanSchema, validateFocusPlan } from "../schemas/focusPlanSchema.js";
import { MissingApiKeyError } from "./transcriptionService.js";

const EXTRACTION_INSTRUCTIONS = `You extract a user's spoken focus plan.
Return only data supported by the transcript. Use null or [] when information is missing.
Distinguish the broader task, today's broader goal, and the concrete goal for this focus session.
Only include duration_minutes when the user explicitly states a duration.
Keep wording concise while preserving the user's meaning.
Generate exactly one small, concrete, immediately actionable suggested_first_step when enough context exists; otherwise use null.
Do not diagnose the user and do not add motivational language.
If several tasks compete and priority is unclear, describe that in needs_confirmation.`;

export async function extractFocusPlan(transcript) {
  if (!process.env.OPENAI_API_KEY) throw new MissingApiKeyError();

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.parse({
    model: process.env.OPENAI_FOCUS_PLAN_MODEL || "gpt-4.1-mini",
    instructions: EXTRACTION_INSTRUCTIONS,
    input: transcript,
    text: {
      format: zodTextFormat(focusPlanSchema, "focus_plan")
    }
  });

  if (!response.output_parsed) {
    const error = new Error("The model did not return a focus plan.");
    error.code = "INVALID_STRUCTURED_OUTPUT";
    throw error;
  }
  return validateFocusPlan(response.output_parsed);
}
