// The review pane: silykat's comments without VS Code, in Claude Code itself (the desktop app's
// panes, or the terminal's). It draws the diff of the working tree, takes comments on its hunks and
// replies in threads through `slk review comment` (so they are the same threads as in VS Code), and
// hands the threads to Claude with the review skill, in this session.
import { atom, read, update } from 'claude-code';
import type { EngineInterface as Engine, Register } from 'claude-code';

import type { PaneThread, PaneView } from '../types';
import { hunksOf, linesOf, rangeLabel } from './review-diff';

const PANE = 'silykat-review';
const TITLE = 'silykat review';
/** What the Send button asks Claude (a plugin may not type a slash command for the user). */
export const SEND_PROMPT =
  'Use the silykat:review skill: handle the silykat threads waiting for you (slk review list), change the code, and reply in each thread.';
const EMPTY: PaneView = { opened: false, files: [], selected: null, diff: '', top: '', threads: [], note: '' };
const view = atom({ plugin: 'silykat', key: 'view' } as const, EMPTY);

/** Runs a command in the session's folder (or `cwd`): its output, or throws with what it said. */
async function run($: Engine, argv: string[], cwd?: string, okCodes: number[] = [0]): Promise<string> {
  const r = await $.process.run(argv, cwd ? { cwd } : {});
  if (!okCodes.includes(r.exitCode)) throw new Error((r.stderr || r.stdout).trim() || `${argv[0]} failed`);
  return r.stdout;
}

/** The `slk` bundled with this plugin. */
function slk($: Engine, args: string[], cwd: string): Promise<string> {
  return run($, ['node', `${$.plugin.root}/bin/slk`, ...args], cwd);
}

async function note($: Engine, text: string): Promise<void> {
  await update($, view, (v) => ({ ...(v ?? EMPTY), note: text }));
}

async function failed($: Engine, err: unknown): Promise<void> {
  await note($, `Failed: ${err instanceof Error ? err.message : String(err)}`);
}

/** The changed files (tracked and new), the selected file's diff and the threads, read again. */
async function refresh($: Engine, selected?: string | null): Promise<void> {
  try {
    const top = (await run($, ['git', 'rev-parse', '--show-toplevel']).catch(() => '')).trim();
    const cwd = top || undefined;
    const tracked = top ? await run($, ['git', 'diff', '--name-only', 'HEAD'], cwd).catch(() => '') : '';
    const added = top ? await run($, ['git', 'ls-files', '--others', '--exclude-standard'], cwd) : '';
    const files = [...new Set([...tracked.split('\n'), ...added.split('\n')].map((f) => f.trim()))]
      .filter((f) => f !== '')
      .sort();
    const current = (await read($, view)) ?? EMPTY;
    const pick = selected !== undefined ? selected : current.selected;
    const file = pick && files.includes(pick) ? pick : (files[0] ?? null);
    const diff = file ? await diffOf($, file, cwd, added.split('\n').includes(file)) : '';
    const threads = await threadsOf($, top || '.');
    await update($, view, (v) => ({ ...(v ?? EMPTY), opened: true, files, selected: file, diff, top, threads }));
  } catch (err) {
    await failed($, err);
  }
}

function diffOf($: Engine, file: string, cwd: string | undefined, isNew: boolean): Promise<string> {
  return isNew
    ? run($, ['git', 'diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', file], cwd, [0, 1])
    : run($, ['git', 'diff', '--no-color', '--no-ext-diff', 'HEAD', '--', file], cwd);
}

async function threadsOf($: Engine, cwd: string): Promise<PaneThread[]> {
  const out = await slk($, ['review', 'list', '--all', '--any-topic', '--format', 'json'], cwd).catch((err) => {
    // A folder nobody commented yet has no store: no thread, not an error.
    if (err instanceof Error && /no silykat store/.test(err.message)) return '[]';
    throw err;
  });
  return JSON.parse(out) as PaneThread[];
}

/** A new thread on lines of `file` (relative to the top), or on the whole file. */
async function commentOn($: Engine, file: string, lines: string | null, body: string): Promise<void> {
  if (body.trim() === '') return;
  const where = `${file}${lines ? `:${lines}` : ''}`;
  await inThread(
    $,
    ['review', 'comment', file, ...(lines ? ['--lines', lines] : []), '--body', body],
    `Commented ${where}.`,
  );
}

/** Runs `slk` at the top of the repository, says what it did, and reads everything again. */
async function inThread($: Engine, args: string[], done: string): Promise<void> {
  const { top } = (await read($, view)) ?? EMPTY;
  try {
    await slk($, args, top || '.');
    await note($, done);
    await refresh($);
  } catch (err) {
    await failed($, err);
  }
}

async function openPane($: Engine): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE });
  await refresh($);
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'review-pane',
      description: 'Open the silykat review pane: comment on the diff, then hand the threads to Claude',
    });
    return next(e);
  });

  on('command.run', { command: 'review-pane' }, async ($) => {
    await openPane($);
    return { text: 'silykat review pane opened.' };
  });

  // Claude may have replied in threads, or changed files: read them again.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e);
    if ((await read($, view))?.opened) await refresh($);
    return done;
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const v = (await read($, view)) ?? EMPTY;
    if (e.surface === 'mobile') {
      // The mobile app draws no field: what waits, read-only.
      const { Text } = $.ui.resolve(e);
      const n = v.threads.filter((t) => t.status !== 'resolved').length;
      return (
        <Text>{`${n} open silykat thread${n === 1 ? '' : 's'}: comment from the desktop app or the terminal.`}</Text>
      );
    }
    const { Box, Text, Button, Input, Select, Code, Markdown } = $.ui.resolve(e);
    const waiting = v.threads.filter((t) => t.needsAgent).length;
    const openThreads = v.threads.filter((t) => t.status !== 'resolved');
    const hunks = hunksOf(v.diff);
    // Never name a variable `h`: JSX compiles against the global `h`.
    // Keys change with the threads, so a field is drawn empty again once its comment is saved.
    const round = v.threads.reduce((n, t) => n + t.comments.length, 0);

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="refresh" onPress={() => void refresh($)}>
            Refresh
          </Button>
          {waiting > 0 && (
            <Button key="send" variant="primary" onPress={() => void $.prompt.submit({ text: SEND_PROMPT })}>
              {`Send ${waiting} thread${waiting === 1 ? '' : 's'} to Claude`}
            </Button>
          )}
        </Box>
        {v.note !== '' && <Text dimColor>{v.note}</Text>}

        <Text bold>Changes</Text>
        {v.files.length === 0 ? (
          <Text dimColor>No change in the working tree.</Text>
        ) : (
          <Select
            key="file"
            label="File"
            value={v.selected ?? v.files[0]}
            options={v.files.map((f) => ({ value: f, label: f }))}
            onSelect={(file) => void refresh($, file)}
          />
        )}
        {v.selected !== null &&
          hunks.map((hunk, i) => (
            <Box key={`hunk-${i}`} flexDirection="column">
              <Code source={hunk.source} path={v.selected ?? undefined} format="diff" />
              <Input
                key={`hunk-${v.selected}-${i}-${round}`}
                label={rangeLabel(hunk.startLine, hunk.endLine)}
                placeholder="Comment on these lines"
                submitLabel="comment"
                onSubmit={(body) => void commentOn($, v.selected!, `${hunk.startLine}-${hunk.endLine}`, body)}
              />
            </Box>
          ))}
        {v.selected !== null && (
          <Input
            key={`file-${v.selected}-${round}`}
            label="Other lines"
            placeholder="12-15 your comment (or just a comment on the whole file)"
            submitLabel="comment"
            onSubmit={(text) => {
              const [first = '', ...rest] = text.trim().split(/\s+/);
              const lines = linesOf(first);
              void commentOn($, v.selected!, lines, lines ? rest.join(' ') : text);
            }}
          />
        )}

        <Text bold>{`Threads (${openThreads.length} open)`}</Text>
        {openThreads.length === 0 && <Text dimColor>No open thread.</Text>}
        {openThreads.map((t) => {
          const last = t.comments[t.comments.length - 1];
          const where = t.range ? `${t.path}:${rangeLabel(t.range.startLine, t.range.endLine)}` : t.path;
          return (
            <Box key={`thread-${t.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
              <Text>
                <Text bold>{where}</Text>
                <Text dimColor>{` · ${t.status}${t.outdated ? ' · outdated' : ''}`}</Text>
              </Text>
              {last && <Markdown key={`last-${t.id}-${t.comments.length}`} text={`**${last.author}**: ${last.body}`} />}
              <Input
                key={`reply-${t.id}-${t.comments.length}`}
                placeholder="Reply"
                submitLabel="reply"
                onSubmit={(body) =>
                  body.trim() !== '' &&
                  void inThread($, ['review', 'comment', '--thread', t.id, '--body', body], `Replied on ${where}.`)
                }
              />
              <Button
                key={`resolve-${t.id}`}
                onPress={() => void inThread($, ['review', 'resolve', t.id], `Resolved ${where}.`)}
              >
                Resolve
              </Button>
            </Box>
          );
        })}
      </Box>
    );
  });
};
