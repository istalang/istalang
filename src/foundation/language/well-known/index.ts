/**
 * What the toolchain knows by name (§2.2, §19.2, §13.1, §17.1): the std modules the language itself
 * refers to by role, the declarations in them it treats specially, and the names a program and its
 * methods are expected to spell. Each name is spelled once in this folder, for the compiler, the
 * Definition, the runtime and the std modules alike: beside this module, the functions constructs
 * call (implicit-calls.ts), the variants the toolchain builds and takes apart (variants.ts), the
 * json module's codecs (codecs.ts) and the testing module's names (testing.ts).
 */

/**
 * The std modules a program is handed by role: the prelude every module sees without importing it
 * (§13.1), `time`, whose `Duration` types every duration literal (§3.1), `json`, whose codecs every
 * value crossing to a host goes through (§17.4), `lifetimes`, whose annotations say what the std's
 * externs hold and keep (§5.5), and `testing`, which only test modules may import and whose suites
 * `ista test` runs (§18).
 */
export const languageModules = {
  prelude: 'prelude',
  time: 'time',
  json: 'json',
  lifetimes: 'lifetimes',
  testing: 'testing',
} as const;

/** A role, which is also the name of the std module that plays it. */
export type LanguageModule = keyof typeof languageModules;

/**
 * The std module of runtimes, contexts and jobs (§14, §17.1), which the toolchain knows by name but a
 * program has only where it imports it, so it plays no role.
 */
export const runtimeModule = 'runtime';

/**
 * The scheme of a std module's id, `std:<name>`. No file can have it, so a std module is never
 * confused with a project file; an editor shows one by asking the language server for its text.
 */
export const stdScheme = 'std';

/** A declaration of a language module the toolchain treats specially. */
export interface WellKnownDeclaration {
  readonly module: LanguageModule;
  readonly name: string;
}

export const wellKnown = {
  /** What an async call returns and `await` waits on (§6.1, §15.2). */
  future: { module: 'prelude', name: 'Future' },
  /**
   * One wait's one-shot resolver: the type of what an awaitable's `onAwait` is given, which says
   * what the wait gives and its kind (proposal 8, Rule 5).
   */
  resolver: { module: 'prelude', name: 'Resolver' },
  /** The one function type, every function type's spelling its sugar (§6.4). */
  fn: { module: 'prelude', name: 'Fn' },
  /** What `spawn` gives: a handle to the new instance, whose end `result()` waits for (§17.1). */
  instance: { module: 'prelude', name: 'Instance' },
  /** What `T?` stands for (§4.2). */
  optional: { module: 'prelude', name: 'Optional' },
  /** The runtime's one primitive for sharing values between executions, run by natives (§15.1). */
  slot: { module: 'prelude', name: 'Slot' },
  /** The cell a captured or referenced variable lives in (§7.3, §6.4). */
  cell: { module: 'prelude', name: '_Cell' },
  /** One value shared by every copy of its handle (§19.1, §5.4). */
  shared: { module: 'prelude', name: 'Shared' },
  /** One `await`'s or `select`'s wait, which its cases' resolvers decide (proposal 8, Rule 5). */
  wait: { module: 'prelude', name: '_Wait' },
  /** What a function that can fail returns, and what `?` takes apart (§12). */
  result: { module: 'prelude', name: 'Result' },
  /** What a cursor gives each call: the next item, or the end (§8.4). */
  step: { module: 'prelude', name: 'Step' },
  /** What a duration literal is (§3.1). */
  duration: { module: 'time', name: 'Duration' },
  /** A point in time, which the host boundary writes as ISO 8601 (§17.4). */
  time: { module: 'time', name: 'Time' },
  /** The marker trait of values that may leave an instance, derived rather than declared (§7.4). */
  sendable: { module: 'prelude', name: 'Sendable' },
  /** The marker trait of values reaching no disposable at any depth, derived like Sendable (§7.4). */
  inert: { module: 'prelude', name: 'Inert' },
  /** The derived trait of types whose kind is one of its argument's marks (proposal 8, Rule 3). */
  dataKind: { module: 'prelude', name: 'DataKind' },
  /** What an array literal or a comprehension builds (§3.1, §8.4). */
  array: { module: 'prelude', name: 'Array' },
  /** What a map literal builds when no other type is expected (§3.3). */
  map: { module: 'prelude', name: 'Map' },
  /** What `a..b` builds (§19.3). */
  range: { module: 'prelude', name: 'Range' },
  /** A weak reference to a disposable (§16). */
  weakRef: { module: 'prelude', name: 'WeakRef' },
  /** The handle of an async call that `worker.disposing()` watches, private to the prelude (§16). */
  call: { module: 'prelude', name: '_Call' },
  /** The future a call's disposal resolves, whose `select` case is the call's cleanup (§16). */
  disposing: { module: 'prelude', name: 'disposing' },
  /**
   * A type with a value to start from (§8.4): a map literal's, and a skipped JSON field's (§17.4).
   */
  default: { module: 'prelude', name: 'Default' },
  /** How a type is written as text, and read back (§8.4): map keys in JSON (§17.4). */
  stringable: { module: 'prelude', name: 'Stringable' },
  parsable: { module: 'prelude', name: 'Parsable' },
  /** Names an `await` or `select` statement's suspension point (§18). */
  waypoint: { module: 'prelude', name: 'Waypoint' },
  /** JSON as a value: what the codecs turn typed values into and back from (§17.4). */
  json: { module: 'json', name: 'Json' },
  /**
   * The traits of types that cross as JSON, written and read (§8.4, §17.4), each implying Sendable.
   */
  encodable: { module: 'json', name: 'Encodable' },
  decodable: { module: 'json', name: 'Decodable' },
  /** Annotations the boundary mapping reads on fields (§5.5, §17.4). */
  jsonName: { module: 'json', name: 'JsonName' },
  jsonSkip: { module: 'json', name: 'JsonSkip' },
  jsonBigInt: { module: 'json', name: 'JsonBigInt' },
  /**
   * What a value of a std extern struct holds, and what a std extern function's parameters come to
   * keep (§5.5): what the analysis of lifetimes can't read off code.
   */
  holds: { module: 'lifetimes', name: 'Holds' },
  keeps: { module: 'lifetimes', name: 'Keeps' },
  /**
   * The stand-ins a shared instance takes for a type parameter its code uses only opaquely, one per
   * representation a primitive isn't (§8.1), and the annotation on a std extern whose native reads
   * no type argument.
   */
  handleStandIn: { module: 'prelude', name: '_Handle' },
  tagStandIn: { module: 'prelude', name: '_Tag' },
  heapStandIn: { module: 'prelude', name: '_Heap' },
  countedStandIn: { module: 'prelude', name: '_Counted' },
  parametric: { module: 'prelude', name: '_Parametric' },
  /** The annotation of a function returning a suite's tests (§18). */
  suite: { module: 'testing', name: 'Suite' },
  /** What a suite function returns a list of (§18). */
  test: { module: 'testing', name: 'Test' },
} as const satisfies Record<string, WellKnownDeclaration>;

/** A declaration's module-qualified name, as a Definition spells it: `prelude.Future`. */
export function qualifiedName({
  module,
  name,
}: {
  readonly module: string;
  readonly name: string;
}): string {
  return `${module}.${name}`;
}

/**
 * The two kinds of code (proposal 8, Rules 1–2), the members of the prelude's `Persistence`: `live`
 * code waits in memory and never commits, `ista` code commits at every wait.
 */
export const persistences = ['live', 'ista'] as const;

export type Persistence = (typeof persistences)[number];

/**
 * What data is and what code may handle (proposal 8, Rule 2), the members of the prelude's
 * `Mark`: `simple`, below both kinds, and the two kinds, `Persistence`'s members.
 */
export const marks = ['simple', ...persistences] as const;

export type Mark = (typeof marks)[number];

/**
 * What a function's values may capture (§6.4), the members of the prelude's `Sendability`: only
 * sendable values, only inert ones (reaching no disposable), or any (`plain`).
 */
export const sendabilities = ['sendable', 'inert', 'plain'] as const;

export type Sendability = (typeof sendabilities)[number];

/** The function every program starts from (§17.1). */
export const entryFunction = 'main';

/** What a method's first parameter is named, which makes it one (§6.2). */
export const receiverParameter = 'self';

/** What a trait calls the type meeting it (§8.2). */
export const selfType = 'Self';
