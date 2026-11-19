/**
 * Disposal ends what it disposes for good (§16), but for the handles the run gives out again: a
 * call's (`_Call`) and a weak reference, whose last holder letting go ends nothing.
 */

import { describe, expect, it } from 'vitest';
import { valueSemanticsOf } from '../../definition/values/equality.ts';
import { Instance } from './instances.ts';
import { Lifetimes } from './lifetimes.ts';
import { Cell } from './objects/cell.ts';
import { Execution } from './objects/execution.ts';
import type { RunObject } from './objects/run-object.ts';
import { WeakReference } from './objects/weak-reference.ts';

/** `object` held, let go of and held again, under lifetimes disposing nothing of its own. */
function heldAgain(object: RunObject): RunObject {
  const lifetimes = new Lifetimes(() => [], [], valueSemanticsOf([]));
  lifetimes.hold(object);
  lifetimes.letGo(object);
  lifetimes.hold(object);
  return object;
}

describe('an object losing its last holder', () => {
  it('is disposed for good, held by nothing after', () => {
    expect(heldAgain(new Cell(1, null, false))).toMatchObject({ disposed: true, count: 0 });
  });

  it.each([
    ['a call', () => new Execution(1, 2, new Instance('i', true))],
    ['a weak reference', () => new WeakReference(1, new Cell(2, null, false))],
  ])("is, as %s's handle, held again as the run gives it out again", (_, made) => {
    expect(heldAgain(made())).toMatchObject({ disposed: false, count: 1 });
  });
});
