/**
 * Generated order notes are stored with machine prefixes so the system can
 * tell them apart (`[Review] …`, `[Copy] Duplicated from …`). The UI strips
 * the marker and localizes the presentation instead of showing the raw
 * English prefix.
 */
export type StepNoteKind = "packing" | "ordering" | "inspection" | "tail";

export type ParsedNote =
  | { kind: "review"; body: string }
  | { kind: "copy"; body: string; sourceNumber: string }
  | { kind: "problem"; body: string }
  | { kind: StepNoteKind; body: string }
  | { kind: "generic"; body: string };

const REVIEW_PREFIX = "[Review] ";
const PROBLEM_PREFIX = "[Problem] ";
const COPY_PATTERN = /^\[Copy\] Duplicated from (.+?) \(re-ship flow\)$/;

const STEP_PREFIXES: Array<[string, StepNoteKind]> = [
  ["[Packing] ", "packing"],
  ["[Ordering] ", "ordering"],
  ["[Inspection] ", "inspection"],
  ["[Tail] ", "tail"],
];

export function parseNoteBody(body: string): ParsedNote {
  if (body.startsWith(REVIEW_PREFIX)) {
    return { kind: "review", body: body.slice(REVIEW_PREFIX.length) };
  }
  if (body.startsWith(PROBLEM_PREFIX)) {
    return { kind: "problem", body: body.slice(PROBLEM_PREFIX.length) };
  }
  const copy = COPY_PATTERN.exec(body);
  if (copy) {
    return { kind: "copy", body: copy[1], sourceNumber: copy[1] };
  }
  for (const [prefix, kind] of STEP_PREFIXES) {
    if (body.startsWith(prefix)) {
      return { kind, body: body.slice(prefix.length) };
    }
  }
  return { kind: "generic", body };
}
