/**
 * A call into an instance holds what its call gave until it is answered (§7, §9): any invocation
 * but the root lets go of it once told, while the root's answer keeps it to finish the instance with.
 */

import { describe, expect, it } from 'vitest';
import { valueSemanticsOf } from '../../definition/values/equality.ts';
import type { Value } from '../../definition/values/values.ts';
import { Instance } from './instances.ts';
import { type Invocation, Invocations } from './invocations.ts';
import { Lifetimes } from './lifetimes.ts';
import { Future } from './objects/future.ts';
import type { RunObject } from './objects/run-object.ts';

/** Invocations of a context, a settled call's future held once, and what its lifetimes disposed. */
function answering(root: boolean) {
  const disposed: RunObject[] = [];
  const lifetimes = new Lifetimes(
    (object) => {
      disposed.push(object);
      return [];
    },
    [],
    valueSemanticsOf([]),
  );
  const invocations = new Invocations(new Instance('c', true), lifetimes);
  const future = new Future(1);
  future.count = 1;
  future.settled = true;
  future.value = 42n;
  const answered: Value[] = [];
  const invocation: Invocation = {
    answer: (end) => {
      if (end.kind === 'returned') {
        answered.push(end.value);
      }
    },
    root,
    hears: () => true,
  };
  invocations.attach(future, invocation);
  return { future, answered, disposed };
}

describe('an invocation answered', () => {
  it('lets go of the future its call gave, once told what it gave', () => {
    const { future, answered, disposed } = answering(false);
    expect(answered).toEqual([42n]);
    expect(future.count).toBe(0);
    expect(disposed).toEqual([future]);
  });

  it("leaves the root's future to its answer, which finishes the instance with it", () => {
    const { future, disposed } = answering(true);
    expect(future.count).toBe(1);
    expect(disposed).toEqual([]);
  });
});
