/**
 * The calling convention (ir-first design, decision 3), its one home: which entries take the shape
 * of a frame record the run keeps, `f<i>(frame)`, and which are plain functions,
 * `f<i>(...parameters, closure)`, nesting on the JS stack. Only the entry's shape reads it (entry.ts);
 * whether a call starts an execution is the IR's `startsExecution`, which compiled code's calls and
 * the run's read. Every entry that starts an execution runs on frames, since its execution parks.
 */

import { type CodeFunction, startsExecution } from '../definition/tables/functions.ts';

/** Whether `entry` is written over a frame record the run keeps, not as a plain function. */
export function runsOnFrames(entry: CodeFunction): boolean {
  return startsExecution(entry);
}
