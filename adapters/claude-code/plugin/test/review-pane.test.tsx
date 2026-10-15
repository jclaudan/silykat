// The review pane under `claude plugin test`: git and slk are answered beneath the plugin.
import { describe, expect, test } from 'claude-code/testing';

import { SEND_PROMPT } from '../hooks/review-pane';

const PANE = 'silykat-review';
const PROPS = { title: 'silykat review', isFocused: true, bodyColumns: 100, placement: 'dock' } as const;
const DIFF = [
  'diff --git a/src/find.ts b/src/find.ts',
  '--- a/src/find.ts',
  '+++ b/src/find.ts',
  '@@ -1,3 +1,4 @@',
  ' export function find(id: string) {',
  '-  return db.get(id);',
  '+  const user = db.get(id);',
  '+  return user ?? null;',
  ' }',
  '',
].join('\n');

const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
});

describe('the review pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`comments on a hunk, then sends the thread to Claude (${surface})`, async ($, on) => {
      const slkCalls: string[][] = [];
      const threads: unknown[] = [];
      const prompts: string[] = [];
      on('ui.open', async () => ({ value: { isPlaced: true } }));
      on('process.run', async (_$, e) => {
        const [cmd, ...args] = e.argv;
        if (cmd === 'git' && args[0] === 'rev-parse') return ran('/repo\n');
        if (cmd === 'git' && args.includes('--name-only')) return ran('src/find.ts\n');
        if (cmd === 'git' && args[0] === 'ls-files') return ran('');
        if (cmd === 'git' && args[0] === 'diff') return ran(DIFF);
        const slk = args.slice(1); // node <plugin>/bin/slk …
        slkCalls.push(slk);
        if (slk[1] === 'list') return ran(JSON.stringify(threads));
        if (slk[1] === 'comment') {
          threads.push({
            id: 't-1',
            path: 'src/find.ts',
            range: { startLine: 2, endLine: 3 },
            status: 'open',
            outdated: false,
            needsAgent: true,
            waitsForUser: false,
            comments: [{ author: 'user', body: slk[slk.indexOf('--body') + 1] }],
          });
          return ran('Commented t-1 (status: open).\n');
        }
        return ran('', 1);
      });
      on('prompt.submit', async (_$, e) => {
        prompts.push(e.text);
        return { text: e.text };
      });

      await $.command.run({ command: 'review-pane', args: '' });
      const ui = await $.ui.mount({ plugin: 'silykat', surface, component: 'Pane', props: PROPS, requestId: PANE });
      expect(await ui.find({ key: 'send' })).toBeUndefined();

      await ui.input({ key: 'hunk-src/find.ts-0-0', text: 'Return a NotFoundError' });
      const comment = slkCalls.find((c) => c[1] === 'comment');
      expect(comment).toEqual([
        'review',
        'comment',
        'src/find.ts',
        '--lines',
        '2-3',
        '--body',
        'Return a NotFoundError',
      ]);

      await ui.press({ key: 'send' });
      expect(prompts).toEqual([SEND_PROMPT]);
    });
  }

  test('comments on other lines, or on the whole file, from one field', async ($, on) => {
    const comments: string[][] = [];
    on('ui.open', async () => ({ value: { isPlaced: true } }));
    on('process.run', async (_$, e) => {
      const [cmd, ...args] = e.argv;
      if (cmd === 'git' && args[0] === 'rev-parse') return ran('/repo\n');
      if (cmd === 'git' && args.includes('--name-only')) return ran('src/find.ts\n');
      if (cmd === 'git') return ran(args[0] === 'diff' ? DIFF : '');
      const slk = args.slice(1);
      if (slk[1] === 'comment') comments.push(slk.slice(2));
      return ran(slk[1] === 'list' ? '[]' : 'ok');
    });
    await $.command.run({ command: 'review-pane', args: '' });
    const ui = await $.ui.mount({
      plugin: 'silykat',
      surface: 'desktop',
      component: 'Pane',
      props: PROPS,
      requestId: PANE,
    });
    await ui.input({ key: 'file-src/find.ts-0', text: '7-9 Extract this' });
    await ui.input({ key: 'file-src/find.ts-0', text: 'Split this file' });
    expect(comments).toEqual([
      ['src/find.ts', '--lines', '7-9', '--body', 'Extract this'],
      ['src/find.ts', '--body', 'Split this file'],
    ]);
  });

  test('says what went wrong when slk fails', async ($, on) => {
    on('ui.open', async () => ({ value: { isPlaced: true } }));
    on('process.run', async (_$, e) => {
      const [cmd, ...args] = e.argv;
      if (cmd === 'git' && args[0] === 'rev-parse') return ran('/repo\n');
      if (cmd === 'git' && args.includes('--name-only')) return ran('src/find.ts\n');
      if (cmd === 'git') return ran(args[0] === 'diff' ? DIFF : '');
      const slk = args.slice(1);
      if (slk[1] === 'list') return ran('[]');
      return ran('', 1, 'slk: cannot read /repo/src/find.ts');
    });
    await $.command.run({ command: 'review-pane', args: '' });
    const ui = await $.ui.mount({
      plugin: 'silykat',
      surface: 'desktop',
      component: 'Pane',
      props: PROPS,
      requestId: PANE,
    });
    await ui.input({ key: 'hunk-src/find.ts-0-0', text: 'x' });
    expect(JSON.stringify(await ui.drawn())).toContain('Failed: slk: cannot read /repo/src/find.ts');
  });
});
