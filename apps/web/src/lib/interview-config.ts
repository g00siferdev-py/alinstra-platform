import { getEnv } from "@alinstra/config";
import { textInterviewConfig } from "@alinstra/db";

export type InterviewActionState =
  | { ok: true; reply?: string; done?: boolean; sessionId?: string }
  | { ok: false; error: string }
  | null;

/** Sync helper — must stay out of `"use server"` modules (Turbopack requires async exports there). */
export function interviewEnabled(): boolean {
  return textInterviewConfig(getEnv()).enabled;
}
