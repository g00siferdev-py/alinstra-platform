import { getEnv } from "@alinstra/config";
import { textInterviewConfig } from "@alinstra/db";

export type InterviewActionState =
  | {
      ok: true;
      reply?: string;
      done?: boolean;
      sessionId?: string;
      transcript?: Array<{ role: "user" | "assistant"; content: string }>;
      captured?: Record<string, unknown>;
    }
  | {
      ok: false;
      error?: string;
      conflict?: boolean;
      transcript?: Array<{ role: "user" | "assistant"; content: string }>;
      captured?: Record<string, unknown>;
      done?: boolean;
    }
  | null;

/** Sync helper — must stay out of `"use server"` modules (Turbopack requires async exports there). */
export function interviewEnabled(): boolean {
  return textInterviewConfig(getEnv()).enabled;
}
