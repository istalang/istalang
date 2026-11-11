import { describe, expect, it } from 'vitest';
import { inlayHintsIn } from './inlay-hints.ts';
import { programAt } from './language-service.test-kit.ts';

/** Each hint, as the text before it on its line and its label. */
function hints(...lines: readonly string[]): readonly string[] {
  const { program, module } = programAt('‸', ...lines);
  const { text } = program.modules.get(module)?.tree.source ?? { text: '' };
  return inlayHintsIn(program, module, { start: 0, end: text.length }).map(
    ({ offset, label }) => `${text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset)}${label}`,
  );
}

describe('inlay hints', () => {
  it('type each name a declaration leaves untyped, destructured ones included', () => {
    expect(
      hints('fn f() -> Int:', '  let (a, b) = (1, "s")', '  const c: Int = a', '  a + c'),
    ).toEqual(['  let (a: Int', '  let (a, b: String']);
  });

  it('type an untyped context constant (§3.4)', () => {
    expect(hints('ista const count = new Shared{value: 0}', 'ista const typed: Int = 1')).toEqual([
      'ista const count: Shared<Int>',
    ]);
  });

  it("type a for's targets and a lambda's untyped parameters", () => {
    expect(
      hints(
        'fn f(items: Array<Int>) -> Int:',
        '  for item in items:',
        '    drop item',
        '  const g: fn(Int, Int) -> Int = fn(x, y: Int): x + y',
        '  g(1, 2)',
      ),
    ).toEqual(['  for item: Int', '  const g: fn(Int, Int) -> Int = fn(x: Int']);
  });

  it('give none for a name whose type checking failed to find', () => {
    expect(hints('fn f() -> Int:', '  let a = missing', '  1')).toEqual([]);
  });
});
