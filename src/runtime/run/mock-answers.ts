/**
 * A mock answering a call (§10), held by the calling instance or one it was spawned from: one path
 * for both, since a mock plays the host wherever it is held.
 *
 * - **Host values cross as their host's JSON.** The replacement takes, records and gives a host
 *   value as JSON and never disposes it; what it gives arrives as the caller's resource for that
 *   JSON (`Run.resource`), which the caller alone disposes (§7). `testing.handle` makes such JSON.
 * - **Other values** pass as they are within one instance; between two, only sendable ones cross,
 *   copied, so neither shares a composite with the other (§9).
 * - **An async replacement's future** is followed by one of the caller's, settled as it settles
 *   within one instance, else in a turn of its own (`Run.arrive`), in whichever run of the
 *   caller's instance it lands in. The holder lets go of its
 *   future once it settles, or once the caller lets go of its own first, as a host frees what a
 *   disposed future waited on: a receive losing a `select` takes nothing.
 */

import { isResourceType, type TypeReference } from '../../definition/tables/types.ts';
import { replacingParts } from '../../definition/values/replacing.ts';
import { type ExternValue, externValue, type Value } from '../../definition/values/values.ts';
import { Panic } from '../natives.ts';
import { Future } from './objects/future.ts';
import type { MockObject } from './objects/mock-object.ts';
import { Resource } from './objects/resource.ts';
import { RunObject } from './objects/run-object.ts';
import type { Run } from './run.ts';

/** Who answers a call with a mock: the instance holding it, which may be the caller's own. */
export interface HeldMock {
  readonly holder: Run;
  readonly mock: MockObject;
}

/**
 * The newest mock of entry `index` held by an instance `caller` was spawned from, the nearest
 * holding one, each read through `runOf` by its name; undefined where none does.
 */
export function heldAbove(
  caller: Run,
  index: number,
  runOf: (name: string) => Run | undefined,
): HeldMock | undefined {
  for (const name of caller.instance.lineage) {
    const holder = runOf(name);
    const mock = holder?.mocking.held.of(index);
    if (holder !== undefined && mock !== undefined) {
      return { holder, mock };
    }
  }
  return undefined;
}

/** What `held` answers `caller`'s call with `passed`, of type `type`, made the caller's own. */
export function answerOfMock(
  caller: Run,
  { holder, mock }: HeldMock,
  passed: readonly Value[],
  type: TypeReference,
): Value {
  const within = holder === caller;
  const given = passed.map((each) => crossing(each, within, hostJson));
  const answer = within
    ? holder.mocking.answer(mock, given)
    : holder.asCall(() => holder.mocking.answer(mock, given));
  if (answer === undefined) {
    // The replacement panicked, ending the holder's instance; the call it answered ends with it.
    throw new Panic(`The instance ${holder.instance.name} holding the mock panicked.`);
  }
  let value: Value;
  if (answer instanceof Future) {
    value = followed({ caller, holder }, answer, awaitedIn(caller, type)) as unknown as Value;
  } else {
    value = arrived(caller, answer as Value, within);
    holder.lifetimes.letGo(answer as Value);
  }
  caller.lifetimes.adopt(value, type);
  return value;
}

/** A future of `caller`'s settling as `answer`, the holder's, does, with what it gives arrived. */
function followed(
  { caller, holder }: { readonly caller: Run; readonly holder: Run },
  answer: Future,
  type: TypeReference | undefined,
): Future {
  const within = holder === caller;
  const future = new Future(caller.newId());
  let held = true;
  const release = () => {
    if (held) {
      held = false;
      if (within) {
        holder.lifetimes.letGo(answer as unknown as Value);
      } else {
        holder.arrivals.arrive(answer, (run, given) =>
          run.lifetimes.letGo(given as unknown as Value),
        );
      }
    }
  };
  // Settles the caller's future in whichever run of its instance the answer lands in.
  const settleIn = (run: Run, target: Future, sent: Value) => {
    const owned = arrived(run, sent, within);
    if (type !== undefined) {
      run.lifetimes.adopt(owned, type);
    }
    run.settle(target, owned);
  };
  const settle = (value: Value) => {
    const sent = crossing(value, within, hostJson);
    release();
    if (within) {
      settleIn(caller, future, sent);
    } else {
      caller.arrivals.arrive(future, (run, target) => settleIn(run, target, sent));
    }
  };
  // A replacement that never waited gives a future settled already.
  const { settled }: { readonly settled: boolean } = answer;
  if (settled) {
    settle(answer.value);
  } else {
    answer.listeners.push(settle);
    future.cancels.push(release);
  }
  return future;
}

/** `value`, given by a mock, as it arrives in `caller`: each host value in it the caller's own. */
function arrived(caller: Run, value: Value, within: boolean): Value {
  return crossing(value, within, (part) =>
    isResourceType(caller.definition.types, part.type)
      ? (caller.resources.of(part.type, part.payload, () => caller.newId()) as unknown as Value)
      : part,
  );
}

/**
 * `value` crossing between a caller and a mock, rebuilt: each host value in it, as its host's JSON,
 * made what `hosted` makes it; any other handle kept `within` one instance, else refused (§10).
 */
function crossing(value: Value, within: boolean, hosted: (part: ExternValue) => Value): Value {
  return replacingParts(value, (part) => {
    if (part instanceof Resource) {
      return hosted(externValue(part.type, part.payload));
    }
    if (part instanceof RunObject) {
      if (within) {
        return part as unknown as Value;
      }
      throw new Panic('A mock in another instance takes and gives only sendable values (§10).');
    }
    return part.kind === 'extern' ? hosted(part) : undefined;
  });
}

/** A host value left as its host's JSON. */
function hostJson(part: ExternValue): Value {
  return part;
}

/** What a future of type `type` settles with: its first type argument. */
function awaitedIn(caller: Run, type: TypeReference): TypeReference | undefined {
  return type.kind === 'named' ? caller.definition.types[type.type]?.arguments[0] : undefined;
}
