/**
 * A resource of a run of compiled code (§7, runtime/natives.ts `NativeResources`): a handle to what
 * its host's JSON holds, made as the value arrives from the host. Its type entry says whether it is
 * counted and how it is disposed, as a cell's does.
 */

import { newObject } from './cell.ts';

export class Resource {
  readonly kind = 'handle';
  readonly object = newObject();
  readonly type: number;
  readonly payload: unknown;

  constructor(type: number, payload: unknown) {
    this.type = type;
    this.payload = payload;
  }
}
