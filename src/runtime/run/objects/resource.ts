/** A resource: a host type's value with a `dispose` (§7, §9), and the payload its natives read. */

import { RunObject } from './run-object.ts';

export class Resource extends RunObject {
  readonly type: number;
  readonly payload: unknown;
  disposed: boolean;

  constructor(id: number, type: number, payload: unknown) {
    super(id);
    this.type = type;
    this.payload = payload;
    this.disposed = false;
  }
}
