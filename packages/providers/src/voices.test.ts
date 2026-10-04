import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_KEY, isVoiceKey, retellVoiceIdFor, VOICE_OPTIONS, voiceDisplayName } from "./voices";

describe("voice map", () => {
  it("maps each wizard label to one Retell voice id and display name", () => {
    expect(VOICE_OPTIONS.map((option) => [option.key, option.retellVoiceId, voiceDisplayName(option.key)])).toEqual([
      ["voice_1", "retell-Brynne", "Brynne (female)"],
      ["voice_2", "retell-Della", "Della (female)"],
      ["voice_3", "retell-Cimo", "Cimo (female)"],
      ["voice_4", "minimax-Jason", "Jason (male)"],
    ]);
  });

  it("defaults to Brynne for new clients and for unset or unknown values", () => {
    expect(DEFAULT_VOICE_KEY).toBe("voice_1");
    expect(retellVoiceIdFor(undefined)).toBe("retell-Brynne");
    expect(retellVoiceIdFor("")).toBe("retell-Brynne");
    expect(retellVoiceIdFor("voice_9")).toBe("retell-Brynne");
    expect(retellVoiceIdFor("voice_4")).toBe("minimax-Jason");
    expect(isVoiceKey("voice_3")).toBe(true);
    expect(isVoiceKey("retell-Cimo")).toBe(false);
  });
});
