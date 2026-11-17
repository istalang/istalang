/**
 * A program's emitted body made a function of the run once (`function(rt)`, codegen/emit.ts): every
 * run of the program, an instance's, a rerun's or a snapshot's read-back, instantiates the same
 * compiled function over itself, so compiling it is paid once per program, not once per run.
 */

import type { EmittedProgram } from '../../codegen/emit.ts';
import { memo } from '../../foundation/structures/memo.ts';
import type { Run } from './run.ts';

/** What instantiates an emitted program over a run: its entries, and the site its traces start at. */
type Instantiator = (rt: Run) => {
  readonly site: Error;
  readonly entries: readonly ((...parameters: never[]) => unknown)[];
};

const instantiators = new WeakMap<EmittedProgram, Instantiator>();

/** The function instantiating `program` over a run, compiled the first time it is asked for. */
export function instantiatorOf(program: EmittedProgram): Instantiator {
  return memo(instantiators, program, () => new Function('rt', program.body) as Instantiator);
}
