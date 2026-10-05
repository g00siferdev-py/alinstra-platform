import { generalBank } from "./general";
import { hvacBank } from "./hvac";
import { veterinaryBank } from "./veterinary";
import type { BankItem, QuestionBank } from "./types";
import type { InterviewIndustry } from "../types";

const EXTRA_BANKS: Record<Exclude<InterviewIndustry, "general">, QuestionBank> = {
  hvac: hvacBank,
  veterinary: veterinaryBank,
};

/** Register a new industry by adding a bank file and an entry here. */
export function banksFor(industry: InterviewIndustry): BankItem[] {
  const extra = industry === "general" ? [] : EXTRA_BANKS[industry].items;
  return [...generalBank.items, ...extra];
}

export function listLoadedBanks(): Array<{ industry: string; itemCount: number }> {
  return [
    { industry: generalBank.industry, itemCount: generalBank.items.length },
    { industry: hvacBank.industry, itemCount: hvacBank.items.length },
    { industry: veterinaryBank.industry, itemCount: veterinaryBank.items.length },
  ];
}

export function resolveInterviewIndustry(value: string | null | undefined): InterviewIndustry {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "hvac") return "hvac";
  if (normalized === "veterinary" || normalized === "vet") return "veterinary";
  return "general";
}

export { generalBank, hvacBank, veterinaryBank };
export type { BankItem, BankFieldPath, QuestionBank } from "./types";
