/**
 * The externs a host implements (§3.6, §9), as natives: a host writes each against JSON, by the
 * extern's key, and this module adapts it to the runtime's native seam. The program calls each
 * through a compiled wrapper (docs/arch/boundary.md), so the values crossing here are always the
 * json module's `Json`.
 *
 * - A host extern takes and gives JavaScript JSON values, what `JSON.parse` of the text gives but
 *   with every integer a `bigint` (definition/values/json-values.ts), so a host needs nothing of
 *   the runtime's value shapes.
 * - An extern returning a `Future` gives back, to an instance, what `call.pending(token)` gave it:
 *   the runtime creates the future, named by the host's token, and the host fills it later
 *   (`Runtime.fill`). To a live run, which waits in memory, it takes the resolver of the live
 *   future its call gives, `call.resolver()`, and resolves it when it can; or, taking none, gives
 *   back a promise of the JSON, which resolves it as it settles (proposal 8, Rule 9). A resolver
 *   taken is the future's one producer: a promise given back as well, as an `async` extern's is,
 *   resolves nothing, though its rejection still panics. Anything else it gives back is its result.
 * - A live resolver is one-shot: a second `resolve` is a bug, which panics the run, and
 *   `tryResolve` says whether it took the value, for races. Its `onCancel` callbacks are called
 *   once its future is disposed unresolved, after which it takes nothing.
 * - A resolver the host lets go of unresolved panics its run, naming the extern. No deterministic
 *   disposal reaches a host's objects, so the runtime learns it as JavaScript collects the resolver
 *   (`FinalizationRegistry`): maybe late, never wrongly, since each of its functions holds it. A
 *   live extern that gives back no promise and takes no resolver dropped it at once.
 * - A result JSON can't hold, a pending future given where none is expected, or a promise that
 *   rejects, is a bug in the host, so it panics the run (§3.12), as a result of the wrong type does
 *   in the wrapper.
 * - This is the one shape the runtime takes. `ista run --host` loads plain functions taking the
 *   arguments spread and returning promises (cli/host-module.ts), and adapts them to it: a promise
 *   can't outlive its process, so only a development host may stand behind one, while a durable
 *   host names each future by a token it can fill from anywhere.
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
  type Native,
  type NativeContext,
  type NativeResolver,
  type Natives,
  Panic,
  type Resolvable,
  type WithFutures,
  type WithResources,
} from '../natives.ts';

/** What a host extern is told about the call it runs. */
export interface HostCall {
  /** The instance calling, as the host names it in `start` and `fill`. */
  readonly instance: string;
  /**
   * What an extern returning a `Future` gives back to an instance: the future the host fills later
   * as `token`, which no future of the instance still waiting on its host may share, or the
   * instance panics.
   */
  readonly pending: (token: string) => HostPending;
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

/** A future the host will fill, as its extern gives it back. */
interface HostPending {
  readonly token: string;
}

/** An extern a host implements, against JSON. */
type HostExtern = (arguments_: readonly unknown[], call: HostCall) => unknown;

/** A host's externs, by key: `purchase.chargeCard(String, Int)`, `purchase.approvalDeadline`. */
export type HostExterns = Readonly<Record<string, HostExtern>>;

type HostContext = NativeContext & WithFutures & WithResources;

/** What one call of an extern made for its future: the pendings it named, the resolver it took. */
interface Made {
  readonly pendings: ReadonlySet<HostPending>;
  readonly taken: Resolvable | undefined;
}

/** Fails the wait of each resolver its host let go of unresolved. */
const dropped = new FinalizationRegistry<() => void>((fail) => {
  fail();
});

/** `host` as natives, by the same keys. */
export function hostNatives(host: HostExterns): Natives<HostContext> {
  return Object.fromEntries(Object.entries(host).map(([key, extern]) => [key, hostNative(extern)]));
}

function hostNative(extern: HostExtern): Native<HostContext> {
  return (values, context) => {
    const shape = jsonTypeOf(context.types);
    const read = (plain: unknown) => jsonOfPlain(plain, shape);
    const pendings = new Set<HostPending>();
    let taken: { readonly resolvable: Resolvable; readonly host: HostResolver } | undefined;
    let running = true;
    const call: HostCall = {
      instance: context.instance,
      pending: (token) => {
        const pending: HostPending = { token };
        pendings.add(pending);
        return pending;
      },
      resolver: () => {
        if (!(running && returnsFuture(context))) {
          throw new Panic(`The host's ${context.name} took a resolver for no future of its call.`);
        }
        if (taken === undefined) {
          const resolvable = context.futures.resolvable();
          taken = { resolvable, host: hostResolverOf(resolvable.resolver, read, context.name) };
        }
        return taken.host;
      },
    };
    let given: unknown;
    try {
      given = extern(
        values.map((value) => plainOfJson(value, shape)),
        call,
      );
    } finally {
      running = false;
    }
    return returnsFuture(context)
      ? futureOf(given, { pendings, taken: taken?.resolvable }, context, read)
      : resultOf(given, pendings, read);
  };
}

/** Whether the extern called returns a future the host fills. */
function returnsFuture({ resultType, types }: NativeContext): boolean {
  return resultType !== undefined && hasRole(types, resultType, 'future');
}

function futureOf(
  given: unknown,
  { pendings, taken }: Made,
  context: HostContext,
  read: (plain: unknown) => Value,
): Value {
  if (given instanceof Promise) {
    const { future, resolver } = taken ?? context.futures.resolvable();
    given.then(
      (plain: unknown) => {
        if (taken === undefined) {
          resolveWith(resolver, plain, read);
        }
      },
      (reason: unknown) => {
        const why = reason instanceof Error ? reason.message : String(reason);
        resolver.fail(new Panic(`The host's ${context.name} rejected: ${why}`, { cause: reason }));
      },
    );
    return future;
  }
  if (pendings.has(given as HostPending)) {
    return context.futures.fromHost((given as HostPending).token);
  }
  if (taken !== undefined) {
    return taken.future;
  }
  throw new Panic(
    `The host's ${context.name} gave no pending future or promise and took no resolver, though it returns a Future.`,
  );
}

function resultOf(
  given: unknown,
  pendings: ReadonlySet<HostPending>,
  read: (plain: unknown) => Value,
): Value {
  if (pendings.has(given as HostPending)) {
    throw new Panic('The host gave a pending future where its extern returns none.');
  }
  return fitting(given, read);
}

/** `resolver` as the host resolves it, with JSON `read` reads, for the extern `name`. */
function hostResolverOf(
  resolver: NativeResolver,
  read: (plain: unknown) => Value,
  name: string,
): HostResolver {
  const host = new JsonResolver(resolver, read, name);
  dropped.register(host, failWhenDropped(resolver, name));
  return host;
}

/**
 * A live future's resolver as its host holds it, taking JSON. Each of its functions holds the
 * whole, so a host keeping only `resolve` keeps it from being collected as dropped.
 */
class JsonResolver implements HostResolver {
  readonly #resolver: NativeResolver;
  readonly #read: (plain: unknown) => Value;
  readonly #name: string;

  constructor(resolver: NativeResolver, read: (plain: unknown) => Value, name: string) {
    this.#resolver = resolver;
    this.#read = read;
    this.#name = name;
  }

  readonly resolve = (value: unknown): void => {
    if (this.#resolver.state === 'resolved') {
      this.#resolver.panic(new Panic(`The host's ${this.#name} resolved its future twice.`));
      return;
    }
    resolveWith(this.#resolver, value, this.#read);
  };

  readonly tryResolve = (value: unknown): boolean => resolveWith(this.#resolver, value, this.#read);

  readonly onCancel = (callback: () => void): void => {
    this.#resolver.onCancel(callback);
  };
}

/**
 * What fails `resolver`'s wait once its host let go of it. It is made here, apart from the host's
 * resolver, since a closure sharing that one's scope would keep it alive and never let it go.
 */
function failWhenDropped(resolver: NativeResolver, name: string): () => void {
  return () => {
    resolver.fail(new Panic(`The host's ${name} dropped its resolver unresolved.`));
  };
}

/**
 * Resolves `resolver` with `plain` as `read` reads it, or fails its wait when JSON can't hold it;
 * whether it took the value.
 */
function resolveWith(
  resolver: NativeResolver,
  plain: unknown,
  read: (plain: unknown) => Value,
): boolean {
  let value: Value;
  try {
    value = fitting(plain, read);
  } catch (error) {
    if (!(error instanceof Panic)) {
      throw error;
    }
    resolver.fail(error);
    return false;
  }
  return resolver.tryResolve(value);
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
