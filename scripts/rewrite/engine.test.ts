/**
 * The engine over whole files: rewrites made where the file spells them, whole or not at all,
 * offsets past a byte order mark, and a pass that isn't its own fixed point stopped.
 */

import { describe, expect, it } from 'vitest';
import { textOf } from '../../src/foundation/text/span.ts';
import { applyEdits } from './edits.ts';
import { rewriteFile, rewritesOf } from './engine.ts';
import { insertion, type Pass } from './pass.ts';
import { deferredCalls } from './passes/deferred-calls/index.ts';
import { embedIsta } from './sources/ista-file.ts';
import { embedTypeScript } from './sources/typescript/index.ts';

describe('rewriteFile', () => {
  it('makes rewrites in a test file wherever its literals spell them', () => {
    const contents = [
      "compiledEncoded(['fn f():', '  defer fn():', '    g()', '  h()'].join('\\n'));",
      "run('fn main():\\n  defer fn(): log(\\'done\\')');",
      'run(`await spawn ${name}().result()`);',
    ].join('\n');
    const { after, applied, refused } = rewriteFile(
      'a.test.ts',
      contents,
      embedTypeScript,
      deferredCalls,
    );
    expect(after).toBe(
      [
        "compiledEncoded(['fn f():', '  _ = defer(fn():', '    g())', '  h()'].join('\\n'));",
        "run('fn main():\\n  _ = defer(fn(): log(\\'done\\'))');",
        'run(`await (spawn ${name}()).result()`);',
      ].join('\n'),
    );
    expect(applied.map(({ rule }) => rule)).toEqual([
      'defer-statement',
      'defer-statement',
      'spawn-chain',
    ]);
    expect(refused).toEqual([]);
  });

  it('refuses a rewrite whose edit the file cannot make, and makes the others', () => {
    const contents = "run(['spawn f()', '.x()', 'spawn g().y'].join('\\n'));";
    const across = { span: { start: 8, end: 11 }, text: '' };
    const pass: Pass = (source) => [
      ...(textOf(source.source, across.span) === ')\n.'
        ? [{ rule: 'across', edits: [insertion(0, '('), across] }]
        : []),
      ...deferredCalls(source),
    ];
    const { after, refused } = rewriteFile('a.test.ts', contents, embedTypeScript, pass);
    expect(after).toBe("run(['spawn f()', '.x()', '(spawn g()).y'].join('\\n'));");
    expect(refused).toEqual([
      {
        rule: 'across',
        at: 5,
        line: 'spawn f()',
        reason: 'it touches a substitution, or the line break joining two strings',
      },
    ]);
  });

  it('counts the byte order mark the source text drops in its offsets', () => {
    const { after } = rewriteFile('m.ista', '\uFEFFdefer f\n', embedIsta, deferredCalls);
    expect(after).toBe('\uFEFF_ = defer(f)\n');
  });
});

describe('rewritesOf', () => {
  it('stops a pass that would rewrite its own output again', () => {
    const growing: Pass = ({ source }) => [
      { rule: 'grow', edits: [insertion(source.text.length, 'x')] },
    ];
    expect(() => rewritesOf('m.ista', 'a', growing)).toThrow('rewrites its own output again');
  });

  it('refuses overlapping edits, which no order makes mean anything', () => {
    const edits = [
      { span: { start: 0, end: 2 }, text: 'a' },
      { span: { start: 1, end: 3 }, text: 'b' },
    ];
    expect(() => applyEdits('abcd', edits)).toThrow('overlap');
  });
});
