// The values of the review pane, kept by Claude Code for the session ($.state).

/** A thread as `slk review list --format json` gives it. */
export interface PaneThread {
  id: string;
  path: string;
  range: { startLine: number; endLine: number } | null;
  status: string;
  outdated: boolean;
  needsAgent: boolean;
  waitsForUser: boolean;
  comments: { author: string; body: string }[];
}

export interface PaneView {
  /** The pane was opened in this session: it is read again after each turn of Claude. */
  opened: boolean;
  /** The changed files of the working tree, relative to the top of the repository. */
  files: string[];
  /** The file whose diff is drawn. */
  selected: string | null;
  /** Its diff against HEAD (or the whole file, when git does not track it). */
  diff: string;
  /** The top of the repository (or the session's folder outside git). */
  top: string;
  threads: PaneThread[];
  /** The last thing done or gone wrong, drawn at the top. */
  note: string;
}

declare module 'claude-code' {
  interface PluginState {
    silykat: { view: PaneView };
  }
}
