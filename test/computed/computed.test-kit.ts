/**
 * Shared helpers for black-box tests of computed types (docs/proposals/4-computed-types.md):
 * resolving written types through the checker, comparing normalized type identity and keys,
 * compiling and running snippets in memory, and generating random struct shapes for property
 * tests.
 */

import fc from 'fast-check';
import { stdProgramOf } from '../../src/compiler/binder/bind.test-kit.ts';
import { reported } from '../../src/compiler/checker/check.test-kit.ts';
import { type Checker, checkProgram } from '../../src/compiler/checker/check.ts';
import { sameType } from '../../src/compiler/checker/types/identity.ts';
import type { Type } from '../../src/compiler/checker/types/type.ts';
import { typeKeys } from '../../src/compiler/checker/types/type-keys.ts';
import { typeText } from '../../src/compiler/checker/types/type-text.ts';
import { compiledText } from '../../src/compiler/compile.test-kit.ts';
import { idOf } from '../../src/compiler/program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../src/compiler/syntax/declarations.ts';
import { decodeJson } from '../../src/definition/codec.ts';
import { startToEnd, testRuntime } from '../../src/runtime/runtime.test-kit.ts';

/** A checked program with `declarations` and a probe function `fn _probe(...parameters)`. */
export interface ProbedTypes {
  readonly checker: Checker;
  readonly types: readonly Type[];
  readonly syntaxErrors: readonly number[];
  readonly diagnosticCodes: readonly number[];
}

/**
 * Parses and checks `fn _probe(p0: T0, p1: T1, ...): ()` after `declarations`, returning the
 * checker, each parameter's resolved `Type`, syntax diagnostic codes, and all diagnostic codes.
 */
export function resolveWrittenTypes(
  writtenTypes: readonly string[],
  declarations: readonly string[] = [],
): ProbedTypes {
  const params = writtenTypes.map((written, index) => `p${index}: ${written}`).join(', ');
  const source = [...declarations, `fn _probe(${params}):`, '  ()'].join('\n');
  const program = stdProgramOf({ 'main.ista': source });
  const checker = checkProgram(program);
  const mod = program.modules.get(idOf('main.ista'));
  const items = mod?.tree.root.items ?? [];
  const probe = items.at(-1);
  const types =
    probe?.kind === 'FunctionDeclaration'
      ? checker.parametersOf(probe as FunctionDeclaration).map((param) => param.type)
      : [];
  const syntaxErrors = (mod?.tree.diagnostics ?? []).map((d) => d.code);
  const diagnosticCodes = reported(source).codes;
  return { checker, types, syntaxErrors, diagnosticCodes };
}

/** Observation comparing two written types `first` and `second` after `declarations`. */
export interface TypeComparison {
  readonly syntaxErrors: readonly number[];
  readonly same: boolean;
  readonly sameKey: boolean;
  readonly assignCodes: readonly number[];
}

/** Compares two written types by `sameType`, `typeKey`, and mutual assignability in the checker. */
export function compareWrittenTypes(
  first: string,
  second: string,
  declarations: readonly string[] = [],
): TypeComparison {
  const { types, syntaxErrors } = resolveWrittenTypes([first, second], declarations);
  const [a, b] = types;
  const same = a !== undefined && b !== undefined && sameType(a, b);
  const sameKey = a !== undefined && b !== undefined && typeKeys.typeKey(a) === typeKeys.typeKey(b);
  const assignCodes = codesOf(
    ...declarations,
    `fn _forward(x: ${first}) -> ${second}: x`,
    `fn _backward(x: ${second}) -> ${first}: x`,
  );
  return { syntaxErrors, same, sameKey, assignCodes };
}

/** Expected observation when two written types are identical and mutually assignable. */
export const sameComputedType: TypeComparison = {
  syntaxErrors: [],
  same: true,
  sameKey: true,
  assignCodes: [],
};

/** The `typeText` of a single written type `written` after `declarations`. */
export function spelledTypeOf(
  written: string,
  declarations: readonly string[] = [],
): string | undefined {
  const { types, syntaxErrors } = resolveWrittenTypes([written], declarations);
  if (syntaxErrors.length > 0) {
    return undefined;
  }
  const [first] = types;
  return first === undefined ? undefined : typeText(first);
}

/** Diagnostic codes reported when checking `lines` as `main.ista` beside the std modules. */
export function codesOf(...lines: readonly string[]): readonly number[] {
  return reported(lines.join('\n')).codes;
}

/**
 * Compiles and runs `async fn main() -> Future<result>: body` after `declarations`, returning the
 * decoded JSON outcome when it finishes, or the ended state otherwise.
 */
export function runMain(
  result: string,
  body: string,
  declarations: readonly string[] = [],
): unknown {
  const source = [...declarations, `async fn main() -> Future<${result}>:`, `  ${body}`].join('\n');
  const state = startToEnd(testRuntime(), compiledText(source));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

/** A generated struct field with a name, type, initial literal, and alternate literal. */
export interface GeneratedField {
  readonly name: string;
  readonly type: 'Int' | 'String' | 'Bool';
  readonly value: string;
  readonly nextValue: string;
}

const fieldPool: GeneratedField[] = [
  { name: 'zeta', type: 'Int', value: '10', nextValue: '11' },
  { name: 'alpha', type: 'String', value: '"a"', nextValue: '"b"' },
  { name: 'mu', type: 'Bool', value: 'true', nextValue: 'false' },
  { name: 'beta', type: 'Int', value: '20', nextValue: '21' },
  { name: 'omega', type: 'String', value: '"z"', nextValue: '"y"' },
];

/** Arbitrary non-empty subset of fields in arbitrary declaration order (to test name-order rules). */
export const generatedFieldsArbitrary: fc.Arbitrary<readonly GeneratedField[]> = fc
  .shuffledSubarray(fieldPool, { minLength: 1, maxLength: 5 })
  .map((items) => [...items]);
