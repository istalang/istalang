/**
 * One function type for both spellings of an async one (§3.14): `async fn(A) -> R` and
 * `fn(A) -> Future<R>` resolve to one type, one key and one text, whatever `A` and `R` are.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { checkProgram } from '../../check.ts';
import { typeKeys } from '../identity/type-keys.ts';
import { typeText } from './type-text.ts';

/** Written types, a function type parenthesized wherever another type holds it. */
const written: fc.Arbitrary<string> = fc.letrec<{ type: string }>((tie) => ({
  type: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom('Int', 'String', 'Unit', 'Int?', 'Bool'),
    tie('type').map((type) => `Array<${type}>`),
    tie('type').map((type) => `Future<${type}>`),
    fc.tuple(tie('type'), tie('type')).map(([first, second]) => `(${first}, ${second})`),
    fc.tuple(tie('type'), tie('type')).map(([taken, given]) => `(fn(${taken}) -> ${given})`),
    fc
      .tuple(tie('type'), tie('type'))
      .map(([taken, given]) => `(sendable async fn(${taken}) -> ${given})`),
  ),
})).type;

/** The types of a function's parameters written `types`, and what checking it reported. */
function resolved(types: readonly string[]) {
  const parameters = types.map((type, index) => `p${index}: ${type}`).join(', ');
  const program = stdProgramOf({ 'main.ista': `fn f(${parameters}):\n  ()\n` });
  const checker = checkProgram(program);
  const [declaration] = program.modules.get(idOf('main.ista'))?.tree.root.items ?? [];
  return {
    types: checker.parametersOf(declaration as FunctionDeclaration).map(({ type }) => type),
    diagnostics: checker.diagnosticsOf(idOf('main.ista')),
  };
}

describe('the two spellings of an async function type', () => {
  it('are one type, with one key and one text', () => {
    fc.assert(
      fc.property(written, written, (taken, given) => {
        const { types, diagnostics } = resolved([
          `async fn(${taken}) -> ${given}`,
          `fn(${taken}) -> Future<${given}>`,
        ]);
        const [async, plain] = types;
        expect(diagnostics).toEqual([]);
        expect(async && typeKeys.typeKey(async)).toBe(plain && typeKeys.typeKey(plain));
        expect(async && typeText(async)).toBe(plain && typeText(plain));
      }),
      { numRuns: 30 },
    );
  });
});
