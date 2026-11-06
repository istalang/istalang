/**
 * Shared helpers for black-box tests of union and literal types (docs/proposals/3-union-types.md):
 * resolving written types through the checker, comparing normalized type identity and keys,
 * compiling and running snippets in memory, and querying hover and completion on union programs.
 */

import { stdProgramOf } from '../../src/compiler/binder/bind.test-kit.ts';
import { reported } from '../../src/compiler/checker/check.test-kit.ts';
import { type Checker, checkProgram } from '../../src/compiler/checker/check.ts';
import { sameType } from '../../src/compiler/checker/types/identity/identity.ts';
import { typeKeys } from '../../src/compiler/checker/types/identity/type-keys.ts';
import type { Type } from '../../src/compiler/checker/types/type/index.ts';
import { typeText } from '../../src/compiler/checker/types/type-text.ts';
import { compiledDefinition, compiledText } from '../../src/compiler/compile.test-kit.ts';
import { idOf } from '../../src/compiler/program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../src/compiler/syntax/declarations/index.ts';
import { decodeJson } from '../../src/definition/codec.ts';
import type { Definition } from '../../src/definition/definition.ts';
import { completionsAt } from '../../src/language-service/completion/index.ts';
import { hoverAt } from '../../src/language-service/hover.ts';
import { programAt } from '../../src/language-service/language-service.test-kit.ts';
import { startToEnd, testRuntime } from '../../src/runtime/runtime.test-kit.ts';

/** A checked program with `declarations` and a probe function `fn _probe(...parameters)`. */
export interface ProbedTypes {
  readonly checker: Checker;
  readonly types: readonly Type[];
  readonly syntaxErrors: readonly number[];
}

/**
 * Parses and checks `fn _probe(p0: T0, p1: T1, ...): ()` after `declarations`, returning the
 * checker, each parameter's resolved `Type`, and any syntax diagnostic codes.
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
  return { checker, types, syntaxErrors };
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

/** Compiles `lines` as `main` beside the std modules and returns its `Definition`. */
export function definitionOf(...lines: readonly string[]): Definition {
  return compiledDefinition(stdProgramOf({ main: lines.join('\n') }), 'main');
}

/** Hover code lines at the `‸` cursor in `lines`. */
export function hoverCodeAt(...lines: readonly string[]): readonly string[] | undefined {
  const { program, module, offset } = programAt(...lines);
  return hoverAt(program, module, offset)?.code;
}

/** Completion item names offered at the `‸` cursor in `lines`. */
export function completionNamesAt(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}
