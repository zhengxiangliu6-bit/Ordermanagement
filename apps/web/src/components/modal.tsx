import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Centered scrollable dialog with a backdrop. Closing via the ✕ button or a
 * backdrop click is left to the caller through `onClose`.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape closes the dialog too.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="pop-shadow mt-10 mb-10 w-full max-w-2xl rounded-xl border border-ink/10 bg-white">
        <div className="flex items-center justify-between border-b border-ink/10 px-5 py-3">
          <h2 className="font-display text-base text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-0.5 text-lg leading-none text-slate-400 transition-colors hover:bg-pill hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
