import type { ReactNode } from "react";

/**
 * Shared UI primitives on the Attaky "Playful Industrial" brand system:
 * locked brand red (#C72B2F) for primary actions, carbon-ink sidebar,
 * paper cards with the signature hard offset shadow, and the playful PLA
 * accent set for status badges.
 */

/** Standard page header: title + optional description + right-side actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl leading-tight text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Section card with a titled header; paper surface, ink hairline. */
export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`pop-shadow-sm rounded-xl border border-ink/10 bg-white ${className}`}
    >
      {title || actions ? (
        <header className="flex items-center justify-between gap-3 border-b border-ink/10 px-4 py-2.5">
          {title ? (
            <h2 className="text-sm font-semibold tracking-wide text-ink">
              {title}
            </h2>
          ) : null}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Semantic tones mapped to the playful PLA palette. */
export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "brand";

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-pill text-slate-600",
  info: "bg-play-blue/10 text-play-blue",
  success: "bg-play-green/15 text-emerald-700",
  warning: "bg-play-yellow/25 text-amber-700",
  danger: "bg-brand/10 text-brand",
  brand: "bg-brand text-white",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Shared empty state: quiet, with an optional action. */
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink/20 bg-white px-6 py-10 text-sm text-slate-400">
      <p>{message}</p>
      {action}
    </div>
  );
}

/** Button class presets; primary carries the brand red + hard shadow. */
export const buttonClasses = {
  primary:
    "pop-shadow rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50",
  secondary:
    "rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:border-ink/50 disabled:opacity-50",
  danger:
    "rounded-lg border border-brand/40 bg-white px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-50",
  ghost:
    "rounded-lg px-2.5 py-1 text-sm text-slate-500 hover:bg-pill hover:text-ink disabled:opacity-50",
};

/** Mono display for codes and numbers (orders, tracking, timestamps). */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px]">{children}</span>;
}
