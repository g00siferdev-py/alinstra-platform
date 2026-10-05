"use client";

import {
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type DragEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export type ButtonVariant = "primary" | "secondary" | "small" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--btn-primary)] px-4 text-sm font-bold text-[var(--btn-primary-ink)] shadow-[0_0_0_4px_var(--btn-halo)] disabled:opacity-60 disabled:shadow-none",
  secondary:
    "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--secondary-border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--primary-text)] hover:bg-[#F4F7FE] disabled:opacity-60",
  small:
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--secondary-border)] bg-[var(--surface)] px-3 text-[13px] font-bold text-[var(--primary-text)] hover:bg-[#F4F7FE] disabled:opacity-60",
  danger:
    "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--danger-text)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--danger-text)] disabled:opacity-60",
};

/** @deprecated Prefer `variant`. Maps old `tone` prop during the reskin. */
const toneToVariant: Record<string, ButtonVariant> = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
};

export const buttonClassName = buttonVariants.primary;

export function Button({
  variant,
  tone,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** @deprecated use variant */
  tone?: "primary" | "secondary" | "danger";
}) {
  const resolved = variant ?? (tone ? toneToVariant[tone] : "primary") ?? "primary";
  return <button className={`${buttonVariants[resolved]} ${className}`.trim()} {...props} />;
}

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-[20px] bg-[var(--surface)] shadow-[var(--shadow-card)] ${padded ? "p-6" : ""} ${className}`.trim()}
    >
      {children}
    </section>
  );
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="mb-1 block text-[13px] font-semibold text-[var(--ink)]" {...props} />;
}

const fieldClass =
  "w-full rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)]";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={fieldClass} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} min-h-24 resize-y`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={fieldClass} {...props} />;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--danger-text)]">{children}</p>;
}

export type PillTone = "success" | "warning" | "danger" | "info" | "neutral" | "live" | "purple";

const pillTones: Record<PillTone, string> = {
  success: "bg-[var(--success-soft)] text-[var(--success-text)]",
  warning: "bg-[var(--warning-pill)] text-[var(--warning-text)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
  info: "bg-[var(--primary-soft)] text-[var(--primary-text)]",
  neutral: "bg-[var(--neutral-soft)] text-[var(--neutral-text)]",
  live: "bg-[var(--live-soft)] text-[var(--live-text)]",
  purple: "bg-[var(--purple-soft)] text-[var(--purple-text)]",
};

export function Pill({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${pillTones[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

export function IconTile({
  children,
  soft = "var(--primary-soft)",
  className = "",
}: {
  children: ReactNode;
  soft?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${className}`.trim()}
      style={{ background: soft }}
    >
      {children}
    </span>
  );
}

export function StatCard({
  icon,
  value,
  label,
  soft,
  emphasize,
}: {
  icon: ReactNode;
  value: string | number;
  label: string;
  soft?: string;
  emphasize?: boolean;
}) {
  return (
    <Card className="grid gap-3">
      <IconTile soft={soft}>{icon}</IconTile>
      <p
        className={`text-[28px] font-extrabold tabular-nums tracking-tight ${emphasize ? "text-[var(--warning-text)]" : "text-[var(--ink)]"}`}
      >
        {value}
      </p>
      <p className="text-[13px] font-semibold text-[var(--muted)]">{label}</p>
    </Card>
  );
}

export function ProgressBar({
  value,
  max,
  className = "",
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`h-2.5 w-full overflow-hidden rounded-full bg-[var(--divider)] ${className}`.trim()}>
      <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid min-w-0 gap-1">
        {eyebrow ? <p className="text-[13px] font-semibold text-[var(--muted)]">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-[var(--ink)]">{title}</h1>
        {description ? <p className="text-sm text-[var(--body)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card padded={false} className={className}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--divider)] px-5 py-4">
        <h2 className="text-base font-extrabold text-[var(--ink)]">{title}</h2>
        {action}
      </div>
      <div className="divide-y divide-[var(--divider)]">{children}</div>
    </Card>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="grid gap-1 px-5 py-8 text-center">
      <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
      {description ? <p className="text-sm text-[var(--muted)]">{description}</p> : null}
    </div>
  );
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
      className={`grid gap-1 rounded-xl border border-dashed px-4 py-6 text-center ${dragOver ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--line)]"} ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
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
      <p className={shownError && !uploadingName ? "text-sm text-[var(--danger-text)]" : "text-sm"}>{headline}</p>
      {uploadingName ? null : <p className="text-xs text-[var(--muted)]">PDF, DOCX, TXT, CSV. Up to 10 MB.</p>}
    </div>
  );
}

/** Five-bar Waveform A mark for the logo tile. */
export function WaveformMark({ className = "h-4 w-4 text-white" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect x="1" y="7" width="2.5" height="6" rx="1.25" fill="currentColor" />
      <rect x="5.5" y="4" width="2.5" height="12" rx="1.25" fill="currentColor" />
      <rect x="10" y="2" width="2.5" height="16" rx="1.25" fill="currentColor" />
      <rect x="14.5" y="5" width="2.5" height="10" rx="1.25" fill="currentColor" />
    </svg>
  );
}
