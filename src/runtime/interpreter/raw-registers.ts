/**
 * The one raw write of a register: it puts contents in place and reports nothing. Only registers.ts
 * imports it (.dependency-cruiser.mjs), as the seam that reports every register write as a holder
 * write (runtime/lifetimes/holder-writes.ts); every other module reads a frame's registers, typed
 * read-only (frames.ts), and writes them through registers.ts.
 */

import type { Register } from '../../definition/operands.ts';
import type { RegisterContents } from '../snapshot/objects.ts';
import type { ActiveFrame } from './frames.ts';

/** Puts `contents` in `register` of `frame`, an empty register for none, reporting nothing. */
export function setRegister(
  frame: ActiveFrame,
  register: Register,
  contents: RegisterContents | undefined,
): void {
  (frame.registers as (RegisterContents | undefined)[])[register] = contents;
}
