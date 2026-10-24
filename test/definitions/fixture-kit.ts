/**
 * Helpers for writing Definitions by hand. A fixture spells out every instruction, so these keep
 * only the repetitive shapes short. Spans are found by searching the fixture's own source text,
 * and line starts come from that text through LineMap, so a fixture stays readable and honest.
 */

import type { FunctionDefinition } from '../../src/definition/functions.ts';
import type { Tables } from '../../src/definition/tables.ts';
import type { TypeReference } from '../../src/definition/types.ts';
import { LineMap } from '../../src/text/line-map.ts';

interface Span {
  readonly start: number;
  readonly end: number;
}

/** The span of the first occurrence of `snippet` in `source`. */
export function spanOf(source: string, snippet: string): Span {
  const start = source.indexOf(snippet);
  if (start < 0) {
    throw new Error(`Fixture source has no ${JSON.stringify(snippet)}.`);
  }
  return { start, end: start + snippet.length };
}

/** For declarations without source in the fixture, such as prelude externs. */
export const noSpan: Span = { start: 0, end: 0 };

/** A module entry; without `source`, the module is one empty line. */
export function sourceModule(id: string, source = ''): Tables['modules'][number] {
  return { id, lineStarts: [...new LineMap(source).lineStarts] };
}

export const int = { kind: 'primitive', name: 'int' } as const satisfies TypeReference;
export const string = { kind: 'primitive', name: 'string' } as const satisfies TypeReference;
export const unit = { kind: 'primitive', name: 'unit' } as const satisfies TypeReference;

export function named(type: number): TypeReference {
  return { kind: 'named', type };
}

export function valueArgument(register: number) {
  return { kind: 'value', register } as const;
}

export function functionCallee(id: number) {
  return { kind: 'function', function: id } as const;
}

interface ExternSignature {
  readonly module: number;
  readonly key: string;
  readonly parameters: readonly TypeReference[];
  readonly result: TypeReference;
  readonly typeArguments?: readonly TypeReference[];
}

/** A function-table entry bound to a native; its name is the key's text before the signature. */
export function externFunction(signature: ExternSignature): FunctionDefinition {
  return {
    kind: 'extern',
    name: signature.key.slice(0, signature.key.indexOf('(')),
    module: signature.module,
    span: noSpan,
    annotations: [],
    key: signature.key,
    constant: false,
    parameters: signature.parameters.map((type) => ({ type, reference: false })),
    result: signature.result,
    typeArguments: [...(signature.typeArguments ?? [])],
  };
}
