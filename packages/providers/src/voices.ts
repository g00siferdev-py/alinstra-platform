/**
 * The one place that maps the wizard's voice labels to Retell voice ids.
 * Used by the wizard, the admin client page, change review, and the Retell payload.
 * Pure data: safe to import from client components.
 */
export type VoiceKey = "voice_1" | "voice_2" | "voice_3" | "voice_4";

export type VoiceOption = {
  key: VoiceKey;
  retellVoiceId: string;
  name: string;
  gender: "female" | "male";
};

export const VOICE_OPTIONS: readonly VoiceOption[] = [
  { key: "voice_1", retellVoiceId: "retell-Brynne", name: "Brynne", gender: "female" },
  { key: "voice_2", retellVoiceId: "retell-Della", name: "Della", gender: "female" },
  { key: "voice_3", retellVoiceId: "retell-Cimo", name: "Cimo", gender: "female" },
  { key: "voice_4", retellVoiceId: "minimax-Jason", name: "Jason", gender: "male" },
];

export const VOICE_KEYS: readonly VoiceKey[] = VOICE_OPTIONS.map((option) => option.key);

/** New clients start on Brynne. */
export const DEFAULT_VOICE_KEY: VoiceKey = "voice_1";

export function isVoiceKey(value: unknown): value is VoiceKey {
  return typeof value === "string" && (VOICE_KEYS as readonly string[]).includes(value);
}

export function voiceOption(key: unknown): VoiceOption {
  return VOICE_OPTIONS.find((option) => option.key === key) ?? VOICE_OPTIONS[0]!;
}

/** "Brynne (female)" for pickers and summaries; falls back to the default voice when unset. */
export function voiceDisplayName(key: unknown): string {
  const option = voiceOption(key);
  return `${option.name} (${option.gender})`;
}

/** The Retell `voice_id` to publish for a client's selection. Unset or unknown keys use the default voice. */
export function retellVoiceIdFor(key: unknown): string {
  return voiceOption(key).retellVoiceId;
}
