/**
 * A program's emitted body made a function of the run (`function(rt)`, codegen/emit.ts), which
 * every run of the program, an instance's, a rerun's or a snapshot's read-back, instantiates over
 * itself.
 */

import type { EmittedProgram } from '../../codegen/emit.ts';
import type { Run } from './run.ts';

/** What instantiates an emitted program over a run: its entries, and the site its traces start at. */
type Instantiator = (rt: Run) => {
  readonly site: Error;
  readonly entries: readonly ((...parameters: never[]) => unknown)[];
};

/** The function instantiating `program` over a run. */
export function instantiatorOf(program: EmittedProgram): Instantiator {
  return new Function('rt', program.body) as Instantiator;
}
