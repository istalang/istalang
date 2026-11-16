/**
 * The expansion rule (§3.5) over generated call graphs: a call is reported exactly when it passes
 * a type argument built from the caller's own parameter and the callee leads back to the caller.
 * Checking a module stays lazy: it never checks the body of a generic function it can't reach.
 */

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { lineMapOf } from '../../../../foundation/text/line-map.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt, wholeProgramTimeout } from '../../../compile.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { checkProgram } from '../../check.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

/** A call from `f<from>` to `f<to>`, passing `x` itself or `[x]`, an array built from it. */
interface Call {
  readonly from: number;
  readonly to: number;
  readonly expanding: boolean;
}

const functionCount = 4;

const calls = fc.array(
  fc.record({
    from: fc.nat(functionCount - 1),
    to: fc.nat(functionCount - 1),
    expanding: fc.boolean(),
  }),
  { maxLength: 8 },
);

/** The program making `made`, and the line each call is on. */
function programMaking(made: readonly Call[]): { text: string; lines: Map<Call, number> } {
  const text: string[] = [];
  const lines = new Map<Call, number>();
  for (let index = 0; index < functionCount; index += 1) {
    text.push(`fn f${index}<T>(x: T) -> Int:`);
    for (const call of made.filter(({ from }) => from === index)) {
      lines.set(call, text.length + 1);
      text.push(`  const c${lines.size} = f${call.to}(${call.expanding ? '[x]' : 'x'})`);
    }
    text.push('  1');
  }
  return { text: text.join('\n'), lines };
}

/** Whether `f<from>` calls `f<to>`, directly or through others. */
function leadsTo(made: readonly Call[], from: number, to: number): boolean {
  const reached = new Set<number>();
  const pending = [from];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const call of made.filter((each) => each.from === node && !reached.has(each.to))) {
      reached.add(call.to);
      pending.push(call.to);
    }
  }
  return reached.has(to);
}

describe('endless instantiation', () => {
  it('is reported at exactly the expanding calls on a cycle', {
    timeout: wholeProgramTimeout,
  }, () => {
    fc.assert(
      fc.property(calls, (made) => {
        const { text, lines } = programMaking(made);
        const { source, diagnostics } = diagnosedAt(stdProgramOf({ main: text }), 'main');
        const reported = diagnostics
          .filter(({ code }) => code === checkerDiagnostics.expandingInstantiation.code)
          .map(({ span }) => lineMapOf(source).positionAt(span.start).line + 1);
        const expected = made
          .filter(
            (call) =>
              call.expanding && (call.to === call.from || leadsTo(made, call.to, call.from)),
          )
          .map((call) => lines.get(call));
        expect(reported.sort()).toEqual(expected.sort());
      }),
      { numRuns: 60 },
    );
  });

  it("never forms where a codec would spawn: an ista one meets no codec's requirement (§3.3)", () => {
    const main = [
      "import Json from 'json'\nimport * as runtime from 'runtime'",
      'struct Box<T> { value: T }',
      'fn leaf<T is Sendable>(x: T) -> Box<T>: Box{value: x}',
      'ista fn toJson<T is Sendable>(self: Box<T>) -> Json:',
      '  drop spawn leaf(self)',
      '  none',
      'live async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): { drop spawn leaf(1); 0 }',
    ].join('\n');
    const { diagnostics } = diagnosedAt(stdProgramOf({ main }), 'main');
    expect(diagnostics.map(({ code }) => code)).toEqual([]);
  });

  it("checks no body a module's own generic functions don't reach", () => {
    const program = stdProgramOf({
      main: "import helper from 'lib'\nfn useIt() -> Int: helper()",
      lib: 'fn helper() -> Int: 1\nfn grow<T>(x: T) -> Int:\n  grow([x])',
    });
    const checker = checkProgram(program);
    const bodyOf = vi.spyOn(checker, 'bodyOf');
    checker.diagnosticsOf(idOf('main'));
    expect(bodyOf.mock.calls.map(([declaration]) => declaration.name.text)).not.toContain('grow');
    const codes = checker.diagnosticsOf(idOf('lib')).map(({ code }) => code);
    expect(codes).toContain(checkerDiagnostics.expandingInstantiation.code);
  });
});
