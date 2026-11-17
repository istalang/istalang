/**
 * The calling convention (ir-first design, decision 3), its one home: which entries run on a frame
 * record the run keeps, `f<i>(frame)`, started as an execution of their own, and which are plain
 * functions, `f<i>(...parameters, closure)`, nesting on the JS stack. The entry's signature
 * (entry.ts), compiled code's call of it (instructions.ts) and the run's (runtime/run/run.ts) each
 * read this predicate, so moving entries onto frames changes them together.
 */

import { type CodeFunction, startsExecution } from '../definition/tables/functions.ts';

/** Whether `entry` runs on a frame record the run keeps, not on the JS stack: each that starts an execution. */
export function runsOnFrames(entry: CodeFunction): boolean {
  return startsExecution(entry);
}
