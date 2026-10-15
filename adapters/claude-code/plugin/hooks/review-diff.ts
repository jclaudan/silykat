// The diff the review pane draws, cut into hunks: plain functions, no engine, tested with vitest.

/** One hunk of a file's unified diff, and the lines of the working tree a comment on it is about. */
export interface Hunk {
  /** `@@ … @@` and its lines, as `git diff` wrote them: what the pane draws. */
  source: string;
  /** The new side's changed lines (1-based, inclusive), or around a deletion the line after it. */
  startLine: number;
  endLine: number;
}

const HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** The hunks of a unified diff of one file (headers before the first `@@` are left out). */
export function hunksOf(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let lines: string[] = [];
  let next = 0; // the new side's number of the next line
  let first = 0;
  let last = 0;
  let start = 0;
  const close = () => {
    if (lines.length === 0) return;
    // A hunk that only deletes: the line where the deleted code was.
    const [s, e] = first > 0 ? [first, last] : [Math.max(1, start), Math.max(1, start)];
    hunks.push({ source: lines.join('\n'), startLine: s, endLine: e });
    lines = [];
  };
  for (const line of diff.split(/\r?\n/)) {
    const header = HEADER.exec(line);
    if (header) {
      close();
      start = Number(header[1]);
      next = start;
      first = 0;
      last = 0;
      lines = [line];
      continue;
    }
    if (lines.length === 0) continue; // diff --git, index, ---, +++
    if (line.startsWith('+')) {
      if (first === 0) first = next;
      last = next;
      next++;
    } else if (line.startsWith(' ')) next++;
    else if (!line.startsWith('-') && !line.startsWith('\\')) continue; // the empty line ending the output
    lines.push(line);
  }
  close();
  return hunks;
}

/** `12` or `12-15`, a line range of the pane's comment field; `null` when it is not one. */
export function linesOf(text: string): string | null {
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(text.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  return a >= 1 && b >= a ? (a === b ? `${a}` : `${a}-${b}`) : null;
}

/** The label of a range: `L12` or `L12-15`. */
export const rangeLabel = (startLine: number, endLine: number): string =>
  startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
