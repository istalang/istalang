/**
 * The range check every index a Definition's tables hold goes through, in code, values, types and
 * entries, and the context each reference check reports through (references.ts).
 */

import type { Operands } from '../instructions/instruction.ts';
import type { Tables } from '../tables/index.ts';

export type Path = readonly (string | number)[];

/** The tables being checked, and where problems go. */
export interface Context {
  readonly tables: Tables;
  readonly report: (path: Path, message: string) => void;
}

/** Indexes something refers to, by table; a table left out is not referred to. */
type Indexes = Partial<Operands> & { readonly modules?: readonly number[] };

interface Frame {
  readonly registers: number;
  readonly labels: number;
}

/**
 * The one range check for every index, in code, values, types and entries: each id against its
 * table's size, or for registers and labels against the frame's.
 */
export function outOfRange(
  tables: Tables,
  indexes: Indexes,
  frame: Frame = { registers: 0, labels: 0 },
): readonly string[] {
  const limits = [
    ['register', indexes.registers, frame.registers],
    ['label', indexes.labels, frame.labels],
    ['module', indexes.modules, tables.modules.length],
    ['function', indexes.functions, tables.functions.length],
    ['type', indexes.types, tables.types.length],
    ['constant', indexes.constants, tables.constants.length],
  ] as const;
  return limits.flatMap(([what, ids = [], count]) =>
    ids.filter((id) => id >= count).map((id) => `${what} ${id} is out of range (${count}).`),
  );
}

/** Reports every out-of-range index at `path`; true when all are in range. */
export function inRange(context: Context, indexes: Indexes, path: Path, frame?: Frame): boolean {
  const problems = outOfRange(context.tables, indexes, frame);
  for (const problem of problems) {
    context.report(path, problem);
  }
  return problems.length === 0;
}
