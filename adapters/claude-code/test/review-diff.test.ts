import { describe, expect, it } from 'vitest';
import { hunksOf, linesOf, rangeLabel } from '../plugin/hooks/review-diff';

describe('the hunks the review pane comments on', () => {
  it('gives each hunk the new lines it changed, headers of the file left out', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      'index 1..2 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,3 +1,4 @@',
      ' one',
      '-two',
      '+TWO',
      '+two and a half',
      ' three',
      '@@ -10,2 +11,3 @@ function f() {',
      ' ten',
      '+eleven',
      ' twelve',
      '',
    ].join('\n');
    const hunks = hunksOf(diff);
    expect(hunks.map((h) => [h.startLine, h.endLine])).toEqual([
      [2, 3],
      [12, 12],
    ]);
    expect(hunks[0]!.source).toBe('@@ -1,3 +1,4 @@\n one\n-two\n+TWO\n+two and a half\n three');
  });

  it('puts a hunk that only deletes on the line where the code was', () => {
    expect(hunksOf('@@ -4,2 +4,0 @@\n-gone\n-too').map((h) => [h.startLine, h.endLine])).toEqual([[4, 4]]);
    expect(hunksOf('@@ -1 +0,0 @@\n-all').map((h) => [h.startLine, h.endLine])).toEqual([[1, 1]]);
  });

  it('reads a new file, CRLF output and the no-newline marker', () => {
    const hunks = hunksOf(
      '--- /dev/null\r\n+++ b/n.ts\r\n@@ -0,0 +1,2 @@\r\n+a\r\n+b\r\n\\ No newline at end of file\r\n',
    );
    expect(hunks).toEqual([
      { source: '@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file', startLine: 1, endLine: 2 },
    ]);
  });

  it('has no hunk for no change', () => {
    expect(hunksOf('')).toEqual([]);
  });
});

describe('the line range typed in the pane', () => {
  it('reads a line or a range, and nothing else', () => {
    expect(linesOf('12')).toBe('12');
    expect(linesOf(' 12 - 15 ')).toBe('12-15');
    expect(linesOf('7-7')).toBe('7');
    expect(linesOf('15-12')).toBeNull();
    expect(linesOf('0')).toBeNull();
    expect(linesOf('Split')).toBeNull();
  });

  it('labels a range as the editor does', () => {
    expect(rangeLabel(3, 3)).toBe('L3');
    expect(rangeLabel(3, 9)).toBe('L3-9');
  });
});
