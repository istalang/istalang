/**
 * The externs a host implements (§3.6, §9), as natives: a host writes each against JSON, by the
 * extern's key, and this module adapts it to the runtime's native seam. The program calls each
 * through a compiled wrapper (docs/arch/boundary.md), so the values crossing here are always the
 * json module's `Json`.
 *
 * - A host extern takes and gives JavaScript JSON values, what `JSON.parse` of the text gives but
 *   with every integer a `bigint` (definition/values/json-values.ts), so a host needs nothing of
 *   the runtime's value shapes.
 * - An extern returning a `Future` is live (proposal 8, Rule 9; the checker refuses any other), so
 *   only a live run calls one, which waits in memory: its wrapper passes it the run's pending
 *   future it awaits, which the host fills through the resolver it takes, `call.resolver()`, when
 *   it can; or, taking none, gives back a promise of the JSON, which fills it as it settles. A resolver
 *   taken is the future's one producer: a promise given back as well, as an `async` extern's is,
 *   resolves nothing, though its rejection still panics. Anything else it gives back is its result.
 * - A live resolver is one-shot: a second `resolve` is a bug, which panics the run, and
 *   `tryResolve` says whether it took the value, for races. Its `onCancel` callbacks are called
 *   once its future is disposed unresolved, after which it takes nothing.
 * - A resolver the host lets go of unresolved panics its run, naming the extern. No deterministic
 *   disposal reaches a host's objects, so the runtime learns it as JavaScript collects the resolver
 *   (`FinalizationRegistry`): maybe late, never wrongly, since each of its functions holds it. A
 *   live extern that gives back no promise and takes no resolver dropped it at once.
 * - A result JSON can't hold, or a promise that rejects, is a bug in the host, so it panics the run
 *   (§3.12), as a result of the wrong type does in the wrapper.
 * - This is the one shape the runtime takes. `ista run --host` loads plain functions taking the
 *   arguments spread and returning promises (cli/host-module.ts), and adapts them to it.
 */

import { hasRole } from '../../definition/tables/types.ts';
import {
  JsonError,
  jsonOfPlain,
  jsonTypeOf,
  plainOfJson,
} from '../../definition/values/json-values.ts';
import type { Value } from '../../definition/values/values.ts';
import {
  type HostFilling,
  type Native,
  type NativeContext,
  type Natives,
  Panic,
  type WithFutures,
} from '../natives.ts';
import { Refusal } from '../refusal.ts';

/** What a host extern is told about the call it runs. */
export interface HostCall {
  /** The instance or live run calling, as the host named it in `start`. */
  readonly instance: string;
  /**
   * The resolver of the live future an extern returning a `Future` gives a live run, taken while
   * the extern runs; the same one each time.
   */
  readonly resolver: () => HostResolver;
}

/** A live future's resolver, as a host resolves it with JSON (proposal 8, Rule 9). */
export interface HostResolver {
  /** Resolves the future with `value`; a second time panics the run, after `onCancel` nothing. */
  readonly resolve: (value: unknown) => void;
  /** Resolves the future with `value` unless it resolved or was cancelled; whether it took it. */
  readonly tryResolve: (value: unknown) => boolean;
  /** Has `callback` called once if the future is disposed before it resolves. */
  readonly onCancel: (callback: () => void) => void;
}

/** An extern a host implements, against JSON. */
type HostExtern = (arguments_: readonly unknown[], call: HostCall) => unknown;

/** A host's externs, by key: `purchase.chargeCard(String, Int)`, `purchase.approvalDeadline`. */
export type HostExterns = Readonly<Record<string, HostExtern>>;

type HostContext = NativeContext & WithFutures;

/** Fails the wait of each resolver its host let go of unresolved. */
const dropped = new FinalizationRegistry<() => void>((fail) => {
  fail();
});

/**
 * `natives`, the runtime's own, with the externs `host` implements beside them, which every runtime
 * binds a program's externs to; a Refusal for a key `natives` has, such as `time.now()`, which the
 * host would replace.
 */
export function withHost(natives: Natives, host: HostExterns): Natives {
  const shadowed = Object.keys(host).filter((key) => Object.hasOwn(natives, key));
  if (shadowed.length > 0) {
    throw new Refusal(
      'reservedName',
      `The runtime implements ${shadowed.join(', ')} itself, so a host can't.`,
    );
  }
  return { ...natives, ...hostNatives(host) };
}

/** `host` as natives, by the same keys. */
function hostNatives(host: HostExterns): Natives<HostContext> {
  return Object.fromEntries(Object.entries(host).map(([key, extern]) => [key, hostNative(extern)]));
}

function hostNative(extern: HostExtern): Native<HostContext> {
  return (values, context) => {
    const shape = jsonTypeOf(context.types);
    const read = (plain: unknown) => jsonOfPlain(plain, shape);
    const filled = fillsFuture(context) ? context.futures.filling(values.at(-1) ?? null) : undefined;
    const passed = filled === undefined ? values : values.slice(0, -1);
    let taken: HostResolver | undefined;
    let running = true;
    const call: HostCall = {
      instance: context.instance,
      resolver: () => {
        if (!running || filled === undefined) {
          throw new Panic(`The host's ${context.name} took a resolver for no future of its call.`);
        }
        taken ??= hostResolverOf(filled, read, context.name);
        return taken;
      },
    };
    let given: unknown;
    try {
      given = extern(
        passed.map((value) => plainOfJson(value, shape)),
        call,
      );
    } finally {
      running = false;
    }
    if (filled === undefined) {
      return fitting(given, read);
    }
    if (given instanceof Promise) {
      given.then(
        (plain: unknown) => {
          if (taken === undefined) {
            fillWith(filled, plain, read);
          }
        },
        (reason: unknown) => {
          const why = reason instanceof Error ? reason.message : String(reason);
          filled.fail(new Panic(`The host's ${context.name} rejected: ${why}`, { cause: reason }));
        },
      );
    } else if (taken === undefined) {
      throw new Panic(
        `The host's ${context.name} gave no promise and took no resolver, though it returns a Future.`,
      );
    }
    return null;
  };
}

/**
 * Whether the extern called fills a future: its wrapper passes it last, the pending future of the
 * run's it awaits (lowering/synthesized/boundary/host-externs.ts).
 */
function fillsFuture({ signature, types }: NativeContext): boolean {
  const last = signature.parameters.at(-1);
  return last?.kind === 'named' && !hasRole(types, last.type, 'json');
}

/** `filled` as the host resolves it, with JSON `read` reads, for the extern `name`. */
function hostResolverOf(
  filled: HostFilling,
  read: (plain: unknown) => Value,
  name: string,
): HostResolver {
  const host = new JsonResolver(filled, read, name);
  dropped.register(host, failWhenDropped(filled, name));
  return host;
}

/**
 * A host future's resolver as its host holds it, taking JSON. Each of its functions holds the
 * whole, so a host keeping only `resolve` keeps it from being collected as dropped.
 */
class JsonResolver implements HostResolver {
  readonly #filled: HostFilling;
  readonly #read: (plain: unknown) => Value;
  readonly #name: string;

  constructor(filled: HostFilling, read: (plain: unknown) => Value, name: string) {
    this.#filled = filled;
    this.#read = read;
    this.#name = name;
  }

  readonly resolve = (value: unknown): void => {
    if (this.#filled.state() === 'resolved') {
      this.#filled.fail(new Panic(`The host's ${this.#name} resolved its future twice.`));
      return;
    }
    fillWith(this.#filled, value, this.#read);
  };

  readonly tryResolve = (value: unknown): boolean => fillWith(this.#filled, value, this.#read);

  readonly onCancel = (callback: () => void): void => {
    this.#filled.onCancel(callback);
  };
}

/**
 * What fails `filled` once its host let go of it. It is made here, apart from the host's resolver,
 * since a closure sharing that one's scope would keep it alive and never let it go.
 */
function failWhenDropped(filled: HostFilling, name: string): () => void {
  return () => {
    if (filled.state() === 'pending') {
      filled.fail(new Panic(`The host's ${name} dropped its resolver unresolved.`));
    }
  };
}

/**
 * Fills `filled` with `plain` as `read` reads it, or fails it when JSON can't hold it; whether it
 * took the value.
 */
function fillWith(filled: HostFilling, plain: unknown, read: (plain: unknown) => Value): boolean {
  let value: Value;
  try {
    value = fitting(plain, read);
  } catch (error) {
    if (!(error instanceof Panic)) {
      throw error;
    }
    filled.fail(error);
    return false;
  }
  return filled.fill(value);
}

/** What the host gave, `read` as a value; a panic when JSON can't hold it. */
function fitting(given: unknown, read: (plain: unknown) => Value): Value {
  try {
    return read(given);
  } catch (error) {
    if (error instanceof JsonError) {
      throw new Panic(`The host gave what JSON can't hold: ${error.message}`, { cause: error });
    }
    throw error;
  }
}
