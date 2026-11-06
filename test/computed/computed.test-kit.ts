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
import { sameType } from '../../src/compiler/checker/types/identity/identity.ts';
import { typeKeys } from '../../src/compiler/checker/types/identity/type-keys.ts';
import type { Type } from '../../src/compiler/checker/types/type/index.ts';
import { typeText } from '../../src/compiler/checker/types/type-text.ts';
import { compiledText } from '../../src/compiler/compile.test-kit.ts';
import { idOf } from '../../src/compiler/program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../src/compiler/syntax/declarations.ts';
import { dump } from '../../src/compiler/syntax/tree.test-kit.ts';
import { decodeJson } from '../../src/definition/codec.ts';
import { parseText } from '../../src/formatter/format.test-kit.ts';
import { formatText } from '../../src/formatter/format.ts';
import { completionsAt } from '../../src/language-service/completion/index.ts';
import { hoverAt } from '../../src/language-service/hover.ts';
import { programAt } from '../../src/language-service/language-service.test-kit.ts';
import { nameAt } from '../../src/language-service/navigation/declarations.ts';
import { placeOf } from '../../src/language-service/navigation/navigation.test-kit.ts';
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

/** The hover's code lines at the `‸` cursor in `lines`, as `main.ista` beside the std modules. */
export function hoverCodeAt(...lines: readonly string[]): readonly string[] | undefined {
  const { program, module, offset } = programAt(...lines);
  return hoverAt(program, module, offset)?.code;
}

/** Completion item names offered at the `‸` cursor in `lines`. */
export function completionNamesAt(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

/** Declaration places (`module:line:col:text`) that the identifier at `‸` resolves to. */
export function declaredPlacesAt(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  const found = nameAt(program, module, offset);
  return (found?.declarations ?? []).map(({ at }) => placeOf(program, at));
}

/** Formatting `source` twice, and the syntax tree's dump before and after. */
export interface FormattedRoundTrip {
  readonly formatted: string | undefined;
  readonly twice: string | undefined;
  readonly dumpBefore: string;
  readonly dumpAfter: string | undefined;
}

/** Formats `source` twice and dumps its syntax tree before and after. */
export function formatRoundTrip(source: string): FormattedRoundTrip {
  const treeBefore = parseText(source);
  const formatted = formatText(source);
  const twice = formatted === undefined ? undefined : formatText(formatted);
  const treeAfter = formatted === undefined ? undefined : parseText(formatted);
  return {
    formatted,
    twice,
    dumpBefore: dump(treeBefore, treeBefore.root),
    dumpAfter: treeAfter === undefined ? undefined : dump(treeAfter, treeAfter.root),
  };
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
