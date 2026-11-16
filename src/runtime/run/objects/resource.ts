/**
 * A resource: a host type's value with a `dispose` (§7, §9), and the payload its natives read. One
 * whose disposal is the runtime's own (a std type's extern `dispose`) says what disposing it does.
 */

import { RunObject } from './run-object.ts';

export class Resource extends RunObject {
  readonly type: number;
  readonly payload: unknown;
  /** What disposing it does, where its disposal is the runtime's own: a runtime's stops it. */
  readonly release: (() => void) | undefined;
  disposed: boolean;

  constructor(id: number, type: number, payload: unknown, release?: () => void) {
    super(id);
    this.type = type;
    this.payload = payload;
    this.release = release;
    this.disposed = false;
  }
}
