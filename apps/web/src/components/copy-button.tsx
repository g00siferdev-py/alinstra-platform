"use client";

import { useToast } from "@/components/toast";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="cursor-pointer rounded-md border border-[var(--line)] bg-white px-2 py-1 text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => toast.success(`Copied ${label}`),
          () => toast.error(`Could not copy ${label}`),
        );
      }}
    >
      Copy {label}
    </button>
  );
}
