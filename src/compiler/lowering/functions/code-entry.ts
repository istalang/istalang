/**
 * The one builder of a code entry (definition/tables/functions.ts): what a function's lowering and
 * synthesized code each wrote, with the header, mode, parameters and captures that make it an
 * entry, so the two can't assemble the entry apart.
 */

import type { CodeFunction, CodeMode } from '../../../definition/tables/functions.ts';
import type { AnchoredSpan, SegmentBases } from '../../syntax/tree/positions.ts';
import type { EntryHeader } from '../tables/tables.ts';
import type { CodeWriter } from './code-writer.ts';

/** What makes written code an entry: where it is and how it is called. */
export interface CodeEntryShape {
  readonly header: EntryHeader;
  readonly mode: CodeMode;
  /** Whether each parameter has a default, which the entry's prologue computes (§6.1). */
  readonly parameters: readonly { readonly hasDefault: boolean }[];
  readonly captures: number;
  /** The tree of the entry's module, which its instructions' spans point into. */
  readonly tree: SegmentBases;
  /** Where its epilogues stand. */
  readonly span: AnchoredSpan;
}

/** The entry of the code `code` wrote, shaped as `shape` says. */
export function codeEntry(code: CodeWriter, shape: CodeEntryShape): CodeFunction {
  const { header, mode, parameters, captures, tree, span } = shape;
  const { registers, instructions } = code.finish(tree, span);
  return {
    kind: 'code',
    ...header,
    mode,
    parameters: parameters.map(({ hasDefault }) => ({ hasDefault })),
    captures,
    registers,
    instructions,
  };
}
