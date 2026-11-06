/**
 * Which values a `match` leaves unhandled, and which of its cases can never run (§3.11, §4): the
 * usefulness algorithm over pattern matrices (Maranget, "Warnings for pattern matching", 2007).
 *
 * - Patterns are reduced to shapes first (shapes.ts): a constructor with its arguments, or
 *   anything. That keeps this module free of syntax and of the checker, so it is tested on its own
 *   against brute-force enumeration.
 * - A type's constructors come from `Signature`: every variant of an enum, `true` and `false`, the
 *   one shape of a tuple or struct. A type with no finite set of constructors, such as `Int` or
 *   `String`, is covered only by a pattern that takes anything, whatever literals the cases list.
 * - An or-pattern is its alternatives, each a row of its own wherever it stands.
 * - An array's constructors are its lengths, which are endless, so from a length no pattern can
 *   tell apart from longer ones on, they are one constructor (the Rust compiler's way). Its
 *   arguments are a long array's first items, as many as the longest prefix, then its last ones,
 *   as many as the longest suffix, with nothing between that a pattern names. A pattern with a
 *   rest is then every length from its fixed count up, one alternative each.
 * - Missing values are reported as a few witnesses, not all of them: enough to say what to add.
 */

/** A pattern as written, before array patterns are laid out as length constructors. */
export type Shape = AnyShape | ConstructorShape<Shape, string> | OrShape<Shape> | ArrayShape;

/** A pattern after array shapes are laid out as the length constructors they match. */
type LaidOutShape =
  | AnyShape
  | ConstructorShape<LaidOutShape, ConstructorKey>
  | OrShape<LaidOutShape>;

/** A missing-value witness: anything, or a constructor of witnesses. */
export type WitnessShape = AnyShape | ConstructorShape<WitnessShape, ConstructorKey>;

export interface AnyShape {
  readonly kind: 'any';
}

/** The key of an array constructor: its item count, or that count and longer when `orMore`. */
interface LengthKey {
  readonly length: number;
  readonly orMore: boolean;
}

/** Tells constructors of one type apart: a named constructor, or an array length. */
export type ConstructorKey = string | LengthKey;

/** A value built by one constructor, with a shape for each of its arguments. */
interface ConstructorShape<Child = Shape, Key extends ConstructorKey = string> {
  readonly kind: 'constructor';
  readonly key: Key;
  readonly arguments: readonly Child[];
}

/** A value any of `alternatives` matches. */
interface OrShape<Child = Shape> {
  readonly kind: 'or';
  readonly alternatives: readonly Child[];
}

/** An array: its first and last items, and whether a rest between them takes any number. */
interface ArrayShape {
  readonly kind: 'array';
  readonly prefix: readonly Shape[];
  readonly suffix: readonly Shape[];
  readonly hasRest: boolean;
}

export const anyShape: AnyShape = { kind: 'any' };

/** The shape matching no value: of a pattern its part's type rules out (§3.11). */
export const nothingShape: Shape = { kind: 'or', alternatives: [] };

/** The key of the constructor of arrays of `length` items, or `length` and more when `orMore`. */
export function lengthKey(length: number, orMore = false): LengthKey {
  return { length, orMore };
}

/** Whether two constructor keys name the same constructor. */
export function sameConstructorKey(left: ConstructorKey, right: ConstructorKey): boolean {
  if (typeof left === 'string' || typeof right === 'string') {
    return left === right;
  }
  return left.length === right.length && left.orMore === right.orMore;
}

/** One constructor of a type, with its arguments' types. */
export interface ConstructorOf<T, Key extends ConstructorKey = string> {
  readonly key: Key;
  readonly arguments: readonly T[];
}

/**
 * The constructors of a type; for an array type, its item type, since its constructors are lengths;
 * undefined when no finite set of them makes up its values.
 */
export type Signature<T> = (
  type: T,
) => readonly ConstructorOf<T>[] | { readonly items: T } | undefined;

/** How many witnesses of missing values are reported at most. */
const witnessLimit = 3;

/** What analyzing a `match` found. */
export interface Analysis {
  /** Shapes of values no case matches; empty when the cases are exhaustive. */
  readonly missing: readonly WitnessShape[];
  /** The indexes of the cases no value can reach, given the unguarded cases before them. */
  readonly unreachable: readonly number[];
}

/** One case: its pattern's shape, and whether only some values of that shape reach it (a guard). */
export interface CaseShape {
  readonly shape: Shape;
  readonly guarded: boolean;
}

/** Analyzes the cases of a `match` on a value of `type`, in order. */
export function analyze<T>(
  signature: Signature<T>,
  type: T,
  cases: readonly CaseShape[],
): Analysis {
  const longer = longArrays(cases.map(({ shape }) => shape));
  const matrix = new Matrix(signature, longer);
  const unreached: number[] = [];
  const covering: (readonly LaidOutShape[])[] = [];
  for (const [index, { guarded, ...written }] of cases.entries()) {
    const shape = withLengths(written.shape, longer);
    if (!matrix.useful(covering, [shape], [type])) {
      unreached.push(index);
    }
    if (!guarded) {
      covering.push([shape]);
    }
  }
  const missing = matrix.missing(covering, [type]).flatMap(([shape]) => shape ?? []);
  return { missing, unreachable: unreached };
}

/**
 * The length from which arrays are one constructor in an analysis of `shapes`: past every length a
 * pattern fixes, and long enough to hold the longest prefix and the longest suffix side by side.
 */
export function longArrays(shapes: readonly Shape[]): number {
  const extents = shapes.flatMap(arrayExtents);
  const most = (of: (extent: ArrayShape) => number) => Math.max(0, ...extents.map(of));
  const fixed = most(({ prefix, suffix }) => prefix.length + suffix.length);
  return Math.max(
    fixed + 1,
    most(({ prefix }) => prefix.length) + most(({ suffix }) => suffix.length),
  );
}

/** The array shapes in `shape`, at any depth. */
function arrayExtents(shape: Shape): readonly ArrayShape[] {
  switch (shape.kind) {
    case 'any':
      return [];
    case 'constructor':
      return shape.arguments.flatMap(arrayExtents);
    case 'or':
      return shape.alternatives.flatMap(arrayExtents);
    case 'array':
      return [shape, ...[...shape.prefix, ...shape.suffix].flatMap(arrayExtents)];
    default: {
      const unhandled: never = shape;
      return unhandled;
    }
  }
}

/**
 * `shape` with each array shape made the length constructors it matches: one of its length
 * without a rest; with one, each length from its fixed count below `longer`, and the longer ones,
 * its rest's items taking anything.
 */
function withLengths(shape: Shape, longer: number): LaidOutShape {
  switch (shape.kind) {
    case 'any':
      return shape;
    case 'constructor':
      return { ...shape, arguments: shape.arguments.map((each) => withLengths(each, longer)) };
    case 'or':
      return {
        kind: 'or',
        alternatives: shape.alternatives.map((each) => withLengths(each, longer)),
      };
    case 'array': {
      const [prefix, suffix] = [shape.prefix, shape.suffix].map((items) =>
        items.map((each) => withLengths(each, longer)),
      );
      const fixed = (prefix?.length ?? 0) + (suffix?.length ?? 0);
      const filled = (length: number): readonly LaidOutShape[] => [
        ...(prefix ?? []),
        ...Array.from({ length: length - fixed }, () => anyShape),
        ...(suffix ?? []),
      ];
      if (!shape.hasRest) {
        return { kind: 'constructor', key: lengthKey(fixed), arguments: filled(fixed) };
      }
      const lengths = Array.from({ length: longer - fixed }, (_, index) => fixed + index);
      const alternatives: LaidOutShape[] = lengths.map((length) => ({
        kind: 'constructor',
        key: lengthKey(length),
        arguments: filled(length),
      }));
      alternatives.push({
        kind: 'constructor',
        key: lengthKey(longer, true),
        arguments: filled(longer),
      });
      return { kind: 'or', alternatives };
    }
    default: {
      const unhandled: never = shape;
      return unhandled;
    }
  }
}

/** A non-empty row whose first shape is already split across any leading `or` alternatives. */
interface SpecializedRow {
  readonly head: AnyShape | ConstructorShape<LaidOutShape, ConstructorKey>;
  readonly rest: readonly LaidOutShape[];
}

/** The algorithm, over rows of shapes, one column per value still to match. */
class Matrix<T> {
  readonly #signature: Signature<T>;
  /** The length from which arrays are one constructor (`withLengths`). */
  readonly #longer: number;

  constructor(signature: Signature<T>, longer: number) {
    this.#signature = signature;
    this.#longer = longer;
  }

  /** Whether some value matching `vector` matches no row of `written`. */
  useful(
    written: readonly (readonly LaidOutShape[])[],
    vector: readonly LaidOutShape[],
    types: readonly T[],
  ): boolean {
    const [head, ...rest] = vector;
    const [type, ...restTypes] = types;
    if (head === undefined || type === undefined) {
      return written.length === 0;
    }
    if (head.kind === 'or') {
      return head.alternatives.some((alternative) =>
        this.useful(written, [alternative, ...rest], types),
      );
    }
    const rows = withAlternatives(written);
    if (head.kind === 'constructor') {
      const made = this.#constructorOf(type, head.key, head.arguments.length);
      return this.useful(
        specialize(rows, head.key, head.arguments.length),
        [...head.arguments, ...rest],
        [...made.arguments, ...restTypes],
      );
    }
    const complete = this.#completeSignature(rows, type);
    if (complete === undefined) {
      return this.useful(defaultRows(rows), rest, restTypes);
    }
    return complete.some((option) =>
      this.useful(
        specialize(rows, option.key, option.arguments.length),
        [...option.arguments.map(() => anyShape), ...rest],
        [...option.arguments, ...restTypes],
      ),
    );
  }

  /**
   * Vectors of shapes no row matches, at most `witnessLimit`; none when the rows are exhaustive.
   */
  missing(
    written: readonly (readonly LaidOutShape[])[],
    types: readonly T[],
  ): readonly (readonly WitnessShape[])[] {
    const [type, ...restTypes] = types;
    if (type === undefined) {
      return written.length === 0 ? [[]] : [];
    }
    const rows = withAlternatives(written);
    const complete = this.#completeSignature(rows, type);
    if (complete === undefined) {
      const missingRest = this.missing(defaultRows(rows), restTypes);
      if (missingRest.length === 0) {
        return [];
      }
      const unlisted = this.#unlistedConstructor(rows, type);
      return missingRest.map((rest) => [unlisted, ...rest]);
    }
    const witnesses: (readonly WitnessShape[])[] = [];
    for (const option of complete) {
      const arity = option.arguments.length;
      const below = this.missing(specialize(rows, option.key, arity), [
        ...option.arguments,
        ...restTypes,
      ]);
      for (const vector of below) {
        const built: ConstructorShape<WitnessShape, ConstructorKey> = {
          kind: 'constructor',
          key: option.key,
          arguments: vector.slice(0, arity),
        };
        witnesses.push([built, ...vector.slice(arity)]);
      }
      if (witnesses.length >= witnessLimit) {
        break;
      }
    }
    return witnesses.slice(0, witnessLimit);
  }

  /**
   * The constructors of `type` when the rows' first column lists every one of them, so each must
   * be looked at; undefined when some value of `type` is left to the rows taking anything.
   */
  #completeSignature(
    rows: readonly SpecializedRow[],
    type: T,
  ): readonly ConstructorOf<T, ConstructorKey>[] | undefined {
    const all = this.#constructors(type);
    if (all === undefined) {
      return undefined;
    }
    return all.length > 0 && all.every(({ key }) => rowsMention(rows, key)) ? all : undefined;
  }

  /** A shape of a value of `type` that no row lists by its constructor. */
  #unlistedConstructor(rows: readonly SpecializedRow[], type: T): WitnessShape {
    const all = this.#constructors(type);
    const unlisted = all?.find(({ key }) => !rowsMention(rows, key));
    return unlisted === undefined || !all?.some(({ key }) => rowsMention(rows, key))
      ? anyShape
      : {
          kind: 'constructor',
          key: unlisted.key,
          arguments: unlisted.arguments.map(() => anyShape),
        };
  }

  /**
   * The constructor `key` of `type`; for a type with no finite signature, one of `arity` unknowns.
   */
  #constructorOf(type: T, key: ConstructorKey, arity: number): ConstructorOf<T, ConstructorKey> {
    const found = this.#constructors(type)?.find((option) => sameConstructorKey(option.key, key));
    return found ?? { key, arguments: Array.from({ length: arity }, () => type) };
  }

  /**
   * The constructors of `type`: an array's are its lengths, up to the ones no pattern tells apart.
   */
  #constructors(type: T): readonly ConstructorOf<T, ConstructorKey>[] | undefined {
    const signed = this.#signature(type);
    if (signed === undefined || !('items' in signed)) {
      return signed;
    }
    const lengths = Array.from({ length: this.#longer }, (_, length) => ({
      key: lengthKey(length),
      arguments: Array.from({ length }, () => signed.items),
    }));
    const longer = Array.from({ length: this.#longer }, () => signed.items);
    return [...lengths, { key: lengthKey(this.#longer, true), arguments: longer }];
  }
}

/** `rows` with each row whose first shape is an or-pattern made one row per alternative. */
function withAlternatives(rows: readonly (readonly LaidOutShape[])[]): readonly SpecializedRow[] {
  return rows.flatMap(([head, ...rest]): readonly SpecializedRow[] => {
    if (head === undefined) {
      return [];
    }
    if (head.kind === 'or') {
      return withAlternatives(head.alternatives.map((alternative) => [alternative, ...rest]));
    }
    return [{ head, rest }];
  });
}

/** The rows matching a value built by the constructor `key` of `arity`, its arguments laid out. */
function specialize(
  rows: readonly SpecializedRow[],
  key: ConstructorKey,
  arity: number,
): readonly (readonly LaidOutShape[])[] {
  return rows.flatMap(({ head, rest }) => {
    if (head.kind === 'any') {
      return [[...Array.from({ length: arity }, () => anyShape), ...rest]];
    }
    return sameConstructorKey(head.key, key) ? [[...head.arguments, ...rest]] : [];
  });
}

/** The rows whose first column takes anything, without that column. */
function defaultRows(rows: readonly SpecializedRow[]): readonly (readonly LaidOutShape[])[] {
  return rows.flatMap(({ head, rest }) => (head.kind === 'any' ? [rest] : []));
}

function rowsMention(rows: readonly SpecializedRow[], key: ConstructorKey): boolean {
  return rows.some(({ head }) => head.kind === 'constructor' && sameConstructorKey(head.key, key));
}
