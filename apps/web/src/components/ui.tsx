"use client";

import { useRef, useState, type ButtonHTMLAttributes, type DragEvent, type InputHTMLAttributes, type KeyboardEvent, type LabelHTMLAttributes, type ReactNode } from "react";

export const buttonClassName =
  "inline-block cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-center text-sm font-medium text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-60";

export function Card({ children }: { children: ReactNode }) {
  return (
    <section className="w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
      {children}
    </section>
  );
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="mb-1 block text-sm font-medium" {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      {...props}
    />
  );
}

const buttonTones = {
  primary: buttonClassName,
  secondary:
    "inline-block cursor-pointer rounded-md border border-[var(--line)] bg-white px-4 py-2 text-center text-sm font-medium text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "inline-block cursor-pointer rounded-md border border-[var(--danger)] bg-white px-4 py-2 text-center text-sm font-medium text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-60",
} as const;

export function Button({ tone = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof buttonTones }) {
  return <button className={buttonTones[tone]} {...props} />;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--danger)]">{children}</p>;
}

const UPLOAD_EXTENSIONS = new Set(["pdf", "docx", "txt", "csv"]);
const UPLOAD_LIMIT = 10 * 1024 * 1024;

export function FileDropzone({
  uploadingName,
  successName,
  error,
  onFile,
}: {
  uploadingName: string | null;
  successName: string | null;
  error: string | null;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = uploadingName !== null;
  const shownError = localError ?? error;

  function choose(file: File | undefined) {
    if (!file || busy) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!UPLOAD_EXTENSIONS.has(extension)) {
      setLocalError("Upload a PDF, DOCX, TXT, or CSV file.");
      return;
    }
    if (file.size > UPLOAD_LIMIT) {
      setLocalError("That file is over the 10 MB limit.");
      return;
    }
    setLocalError(null);
    onFile(file);
  }

  function openPicker() {
    if (!busy) inputRef.current?.click();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    choose(event.dataTransfer.files[0]);
  }

  const headline = uploadingName
    ? `Uploading ${uploadingName}…`
    : shownError
      ? shownError
      : successName
        ? `File uploaded: ${successName}`
        : "Click to upload or drag a file here";

  return (
    <div
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-disabled={busy}
      onClick={openPicker}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`grid gap-1 rounded-md border border-dashed px-4 py-6 text-center outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${dragOver ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,white)]" : "border-[var(--line)]"} ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".pdf,.docx,.txt,.csv"
        disabled={busy}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className={shownError && !uploadingName ? "text-sm text-[var(--danger)]" : "text-sm"}>{headline}</p>
      {uploadingName ? null : <p className="text-xs text-[var(--muted)]">PDF, DOCX, TXT, CSV. Up to 10 MB.</p>}
    </div>
  );
}
