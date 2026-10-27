/**
 * `ista test` end to end (§10): which modules it finds, what it prints, and its exit codes. What
 * the tests themselves can do is runtime/testing/'s to test; here they only pass, fail or skip.
 */

import { describe, expect, it } from 'vitest';
import { ista, tempProject as project } from '../cli.test-kit.ts';

/** A line reporting one test: its mark, then its title. */
const testLine = /^[✓✗-] /u;

/** A test module with one suite, `title`, of a passing, a failing and a skipped test. */
function suiteModule(title: string): string {
  return [
    "import Suite, Test from 'testing'",
    'async fn passes():',
    '  ()',
    'async fn fails() -> Future<unit>:',
    '  panic("on purpose")',
    `@Suite{"${title}"}`,
    'fn suite() -> Array<Test>: [',
    '  Case{title: "passes", body: passes, focus: Plain},',
    '  Case{title: "fails", body: fails, focus: Plain},',
    '  Case{title: "skipped", body: fails, focus: Skipped},',
    ']',
  ].join('\n');
}

/** A test module with one suite, `title`, of one passing test. */
function passingModule(title: string): string {
  return [
    "import Suite, Test from 'testing'",
    'async fn passes():',
    '  ()',
    `@Suite{"${title}"}`,
    'fn suite() -> Array<Test>: [Case{title: "passes", body: passes, focus: Plain}]',
  ].join('\n');
}

describe('ista test', () => {
  it("runs every test module under the project, printing each test's mark and title, then a count", async () => {
    const root = project({
      'a.test.ista': suiteModule('a'),
      'nested/b.test.ista': passingModule('b'),
      'main.ista': 'async fn main():\n  ()',
    });
    const run = await ista(root, 'test');
    expect(run.code).toBe(1);
    expect(run.err).toBe('');
    const lines = run.out.split('\n');
    expect(lines.filter((line) => testLine.test(line))).toEqual([
      '✓ a › passes',
      '✗ a › fails',
      '- a › skipped',
      '✓ b › passes',
    ]);
    expect(lines[lines.indexOf('✗ a › fails') + 1]).toBe('    on purpose');
    expect(lines.at(-2)).toBe('2 passed, 1 failed, 1 skipped.');
  });

  it('runs the test modules the given files and directories hold, and exits 0 when all pass', async () => {
    const root = project({
      'a.test.ista': suiteModule('a'),
      'dir/b.test.ista': passingModule('b'),
    });
    expect(await ista(root, 'test', 'dir')).toEqual({
      code: 0,
      out: '✓ b › passes\n1 passed, 0 failed, 0 skipped.\n',
      err: '',
    });
    expect((await ista(root, 'test', 'dir/b.test.ista')).code).toBe(0);
  });

  it('runs only the tests whose full title contains --filter', async () => {
    const root = project({ 'a.test.ista': suiteModule('a') });
    expect(await ista(root, 'test', '--filter', 'pass')).toEqual({
      code: 0,
      out: '✓ a › passes\n1 passed, 0 failed, 0 skipped.\n',
      err: '',
    });
  });

  it('fails when no test is found, or when a module has errors, running nothing', async () => {
    expect(await ista(project({ 'main.ista': '' }), 'test')).toEqual({
      code: 1,
      out: '',
      err: 'ista: no test found.\n',
    });
    const broken = await ista(project({ 'a.test.ista': 'fn f() -> int: "text"' }), 'test');
    expect(broken.code).toBe(1);
    expect(broken.out).toBe('');
    expect(broken.err).toContain('error 5001');
  });

  it("can't run with a path that isn't there, or a timeout that isn't milliseconds", async () => {
    const root = project({ 'a.test.ista': passingModule('a') });
    expect(await ista(root, 'test', 'gone')).toEqual({
      code: 2,
      out: '',
      err: 'ista: no such file: gone\n',
    });
    expect((await ista(root, 'test', '--timeout', 'soon')).code).toBe(2);
    expect((await ista(root, 'test', '--timeout', '0')).code).toBe(2);
  });

  it("follows a failure's message with the trace through the failing functions", async () => {
    const root = project({
      'a.test.ista': [
        "import Suite, Test from 'testing'",
        'fn inner() -> unit: panic("trace me")',
        'async fn fails() -> Future<unit>:',
        '  inner()',
        '@Suite{"s"}',
        'fn suite() -> Array<Test>: [Case{title: "t", body: fails, focus: Plain}]',
      ].join('\n'),
    });
    const run = await ista(root, 'test');
    const lines = run.out.split('\n');
    expect(lines[0]).toBe('✗ s › t');
    expect(lines[1]).toBe('    trace me');
    expect(lines[2]?.startsWith('    at a.test.inner ')).toBe(true);
    expect(lines[3]?.startsWith('    at a.test.fails ')).toBe(true);
  });

  it('refuses a non-test module that imports a test module, running nothing', async () => {
    const root = project({
      'a.test.ista': passingModule('a'),
      'prod.ista': "import Suite from './a.test'\nfn y() -> int: 1",
    });
    const run = await ista(root, 'check');
    expect(run.code).toBe(1);
    expect(run.err + run.out).toContain('error 4015');
  });
});
