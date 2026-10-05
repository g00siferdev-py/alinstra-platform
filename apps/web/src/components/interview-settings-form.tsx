"use client";

import { saveInterviewSettingsAction, type InterviewSettingsState } from "@/app/admin/interview/actions";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { useActionState } from "react";

export function InterviewSettingsForm({
  defaults,
}: {
  defaults: {
    textApiBase: string;
    textModel: string;
    textFallbackModel: string;
    budgetInputTokens: number;
    budgetOutputTokens: number;
    reasoningEffort: "off" | "low" | "default";
  };
}) {
  const [state, action, pending] = useActionState(saveInterviewSettingsAction, null as InterviewSettingsState);
  return (
    <form action={action} className="grid max-w-xl gap-3 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-medium">Model and budget</h2>
      <Label htmlFor="textApiBase">API base</Label>
      <Input id="textApiBase" name="textApiBase" defaultValue={defaults.textApiBase} />
      <Label htmlFor="textModel">Model</Label>
      <Input id="textModel" name="textModel" defaultValue={defaults.textModel} />
      <Label htmlFor="textFallbackModel">Fallback model</Label>
      <Input id="textFallbackModel" name="textFallbackModel" defaultValue={defaults.textFallbackModel} />
      <Label htmlFor="budgetInputTokens">Input token budget</Label>
      <Input
        id="budgetInputTokens"
        name="budgetInputTokens"
        type="number"
        min={1000}
        defaultValue={defaults.budgetInputTokens}
      />
      <Label htmlFor="budgetOutputTokens">Output token budget</Label>
      <Input
        id="budgetOutputTokens"
        name="budgetOutputTokens"
        type="number"
        min={500}
        defaultValue={defaults.budgetOutputTokens}
      />
      <Label htmlFor="reasoningEffort">Reasoning effort</Label>
      <select
        id="reasoningEffort"
        name="reasoningEffort"
        defaultValue={defaults.reasoningEffort}
        className="rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
      >
        <option value="default">default (omit)</option>
        <option value="low">low</option>
        <option value="off">off</option>
      </select>
      <p className="text-xs text-[var(--muted)]">
        OpenRouter only. Default omits the field; low sends reasoning.effort=low; off sends effort=none.
      </p>
      {state?.error ? <ErrorText>{state.error}</ErrorText> : null}
      {state?.ok ? <p className="text-sm text-[var(--muted)]">Saved.</p> : null}
      <Button disabled={pending} type="submit">
        Save settings
      </Button>
    </form>
  );
}
