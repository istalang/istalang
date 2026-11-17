/**
 * A call of a function value another instance holds, or the caller's own, run at once in its
 * holder, as a function bound in an instance's slot (slots.ts) answers the calls of the instances
 * spawned from it (§10): one path for both, since the holder plays the host wherever it is.
 *
 * - **Host values cross as their host's JSON.** The function takes and gives a host value as JSON
 *   and never disposes it; what it gives arrives as the caller's resource for that
 *   JSON (`Resources.of`), which the caller alone disposes (§7). `testing.handle` makes such JSON.
 * - **Other values** pass as they are within one instance; between two, only sendable ones cross,
 *   copied, so neither shares a composite with the other (§9).
 * - **An async replacement's future** is followed by one of the caller's, settled as it settles
 *   within one instance, else in a turn of its own (`Arrivals.arrive`), in whichever run of the
 *   caller's instance it lands in. The holder lets go of its
 *   future once it settles, or once the caller lets go of its own first, as a host frees what a
 *   disposed future waited on: a receive losing a `select` takes nothing.
 */

import { isResourceType, type TypeReference } from '../../definition/tables/types.ts';
import { replacingParts } from '../../definition/values/replacing.ts';
import { type ExternValue, externValue, type Value } from '../../definition/values/values.ts';
import { Panic } from '../natives.ts';
import { Future } from './objects/future.ts';
import { Resource } from './objects/resource.ts';
import { RunObject } from './objects/run-object.ts';
import type { Run } from './run.ts';

/** A function value and the instance holding it, which may be the caller's own. */
export interface HeldFunction {
  readonly holder: Run;
  readonly function: Value;
}

/** What `held` gives `caller`'s call with `passed`, of type `type`, made the caller's own. */
export function calledIn(
  caller: Run,
  { holder, function: called }: HeldFunction,
  passed: readonly Value[],
  type: TypeReference,
): Value {
  const within = holder === caller;
  const given = passed.map((each) => crossing(each, within, hostJson));
  const answer = within
    ? holder.callValue(called, given)
    : holder.asCall(() => holder.callValue(called, given));
  if (answer === undefined) {
    // The function panicked, ending the holder's instance; the call it answered ends with it.
    throw new Panic(`The instance ${holder.instance.name} holding the called function panicked.`);
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

/** `value`, given by the holder, as it arrives in `caller`: each host value in it the caller's own. */
function arrived(caller: Run, value: Value, within: boolean): Value {
  return crossing(value, within, (part) =>
    isResourceType(caller.definition.types, part.type)
      ? (caller.resources.of(part.type, part.payload, () => caller.newId()) as unknown as Value)
      : part,
  );
}

/**
 * `value` crossing between a caller and the holder, rebuilt: each host value in it, as its host's
 * JSON, made what `hosted` makes it; any other handle kept `within` one instance, else refused (§10).
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
      throw new Panic(
        'A function another instance holds takes and gives only sendable values (§10).',
      );
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
