/**
 * A cell holds one value: a variable passed by `&` or captured (§3.7, §3.14), a transient's (§3.4),
 * or the struct behind a shared struct's handle (§3.18), whose declared `dispose` runs as it goes.
 */

import type { Value } from '../../../definition/values/values.ts';
import { RunObject } from './run-object.ts';

export class Cell extends RunObject {
  value: Value;
  /** Whether what it holds is counted: its type reaches a disposable. */
  readonly counted: boolean;
  /** The entry of the `dispose` a shared struct's handle declares (§7), run as it is let go of. */
  readonly dispose: number | undefined;

  constructor(id: number, value: Value, counted: boolean, dispose?: number) {
    super(id);
    this.value = value;
    this.counted = counted;
    this.dispose = dispose;
  }
}
