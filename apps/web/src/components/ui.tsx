import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";

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

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="cursor-pointer rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-60"
      {...props}
    />
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--danger)]">{children}</p>;
}
