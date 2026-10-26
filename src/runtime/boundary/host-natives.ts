/**
 * The externs a host implements (§3.6, §9), as natives: a host writes each against JSON, by the
 * extern's key, and this module adapts it to the runtime's native seam. The program calls each
 * through a compiled wrapper (docs/arch/boundary.md), so the values crossing here are always the
 * json module's `Json`.
 *
 * - A host extern takes and gives JavaScript JSON values, what `JSON.parse` of the text gives but
 *   with every integer a `bigint` (definition/json-values.ts), so a host needs nothing of the
 *   runtime's value shapes.
 * - An extern returning a `Future` gives back what `call.pending(token)` gave it: the runtime
 *   creates the future, named by the host's token, and the host fills it later
 *   (`Runtime.fill`). Anything else it gives back is its result.
 * - A result JSON can't hold, or a pending future given where none is expected, is a bug in the
 *   host, so it panics the instance (§3.12), as a result of the wrong type does in the wrapper.
 * - This is the one shape the runtime takes. `ista run --host` loads plain functions taking the
 *   arguments spread and returning promises (cli/host-module.ts), and adapts them to it: a promise
 *   can't outlive its process, so only a development host may stand behind one, while a durable
 *   host names each future by a token it can fill from anywhere.
 */

import { JsonError, jsonOfPlain, jsonTypeOf, plainOfJson } from '../../definition/json-values.ts';
import { hasRole } from '../../definition/types.ts';
import type { Value } from '../../definition/values.ts';
import {
  type Native,
  type NativeContext,
  type NativeHostFutures,
  type Natives,
  Panic,
  type WithResources,
} from '../natives.ts';

/** What a host extern is told about the call it runs. */
export interface HostCall {
  /** The instance calling, as the host names it in `start` and `fill`. */
  readonly instance: string;
  /**
   * What an extern returning a `Future` gives back: the future the host fills later as `token`,
   * which no future of the instance still waiting on its host may share, or the instance panics.
   */
  readonly pending: (token: string) => HostPending;
}

/** A future the host will fill, as its extern gives it back. */
interface HostPending {
  readonly token: string;
}

/** An extern a host implements, against JSON. */
type HostExtern = (arguments_: readonly unknown[], call: HostCall) => unknown;

/** A host's externs, by key: `purchase.chargeCard(string, int)`, `purchase.approvalDeadline`. */
export type HostExterns = Readonly<Record<string, HostExtern>>;

/** `host` as natives, by the same keys. */
export function hostNatives(
  host: HostExterns,
): Natives<NativeContext & NativeHostFutures & WithResources> {
  return Object.fromEntries(Object.entries(host).map(([key, extern]) => [key, hostNative(extern)]));
}

function hostNative(extern: HostExtern): Native<NativeContext & NativeHostFutures & WithResources> {
  return (values, context) => {
    const shape = jsonTypeOf(context.types);
    const pendings = new Set<HostPending>();
    const call: HostCall = {
      instance: context.instance,
      pending: (token) => {
        const pending: HostPending = { token };
        pendings.add(pending);
        return pending;
      },
    };
    const given = extern(
      values.map((value) => plainOfJson(value, shape)),
      call,
    );
    return returnsFuture(context)
      ? futureOf(given, pendings, context)
      : resultOf(given, pendings, (plain) => jsonOfPlain(plain, shape));
  };
}

/** Whether the extern called returns a future the host fills. */
function returnsFuture({ resultType, types }: NativeContext): boolean {
  return resultType !== undefined && hasRole(types, resultType, 'future');
}

function futureOf(
  given: unknown,
  pendings: ReadonlySet<HostPending>,
  context: NativeContext & NativeHostFutures,
): Value {
  if (!pendings.has(given as HostPending)) {
    throw new Panic(
      `The host's ${context.name} gave no pending future, though it returns a Future.`,
    );
  }
  return context.pending((given as HostPending).token);
}

function resultOf(
  given: unknown,
  pendings: ReadonlySet<HostPending>,
  read: (plain: unknown) => Value,
): Value {
  if (pendings.has(given as HostPending)) {
    throw new Panic('The host gave a pending future where its extern returns none.');
  }
  try {
    return read(given);
  } catch (error) {
    if (error instanceof JsonError) {
      throw new Panic(`The host gave what JSON can't hold: ${error.message}`, { cause: error });
    }
    throw error;
  }
}
