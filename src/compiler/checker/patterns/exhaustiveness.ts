/**
 * Which values a `match` leaves unhandled, and which of its cases can never run (§3.11, §4): the
 * usefulness algorithm over pattern matrices (Maranget, "Warnings for pattern matching", 2007).
 *
 * - Patterns are reduced to shapes first (shapes.ts): a constructor with its arguments, or anything.
 *   That keeps this module free of syntax and of the checker, so it is tested on its own against
 *   brute-force enumeration.
 * - A type's constructors come from `Signature`: every variant of an enum, `true` and `false`, the
 *   one shape of a tuple or struct. A type with no finite set of constructors, such as `int` or
 *   `string`, is covered only by a pattern that takes anything, whatever literals the cases list.
 * - Missing values are reported as a few witnesses, not all of them: enough to say what to add.
 */

/** A pattern as exhaustiveness sees it. */
export type Shape = AnyShape | ConstructorShape;

export interface AnyShape {
  readonly kind: 'any';
}

/** A value built by one constructor, with a shape for each of its arguments. */
export interface ConstructorShape {
  readonly kind: 'constructor';
  /** Tells constructors of one type apart: a variant's name, `true`, a literal's value. */
  readonly key: string;
  readonly arguments: readonly Shape[];
}

export const anyShape: AnyShape = { kind: 'any' };

/** One constructor of a type, with its arguments' types. */
export interface ConstructorOf<T> {
  readonly key: string;
  readonly arguments: readonly T[];
}

/** The constructors of a type; undefined when no finite set of them makes up its values. */
export type Signature<T> = (type: T) => readonly ConstructorOf<T>[] | undefined;

/** How many witnesses of missing values are reported at most. */
const witnessLimit = 3;

/** What analyzing a `match` found. */
export interface Analysis {
  /** Shapes of values no case matches; empty when the cases are exhaustive. */
  readonly missing: readonly Shape[];
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
  const matrix = new Matrix(signature);
  const unreachable: number[] = [];
  const covering: (readonly Shape[])[] = [];
  for (const [index, { shape, guarded }] of cases.entries()) {
    if (!matrix.useful(covering, [shape], [type])) {
      unreachable.push(index);
    }
    if (!guarded) {
      covering.push([shape]);
    }
  }
  const missing = matrix.missing(covering, [type]).flatMap(([shape]) => shape ?? []);
  return { missing, unreachable };
}

/** The algorithm, over rows of shapes, one column per value still to match. */
class Matrix<T> {
  readonly #signature: Signature<T>;

  constructor(signature: Signature<T>) {
    this.#signature = signature;
  }

  /** Whether some value matching `vector` matches no row of `rows`. */
  useful(
    rows: readonly (readonly Shape[])[],
    vector: readonly Shape[],
    types: readonly T[],
  ): boolean {
    const [head, ...rest] = vector;
    const [type, ...restTypes] = types;
    if (head === undefined || type === undefined) {
      return rows.length === 0;
    }
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

  /** Vectors of shapes no row matches, at most `witnessLimit`; none when the rows are exhaustive. */
  missing(rows: readonly (readonly Shape[])[], types: readonly T[]): readonly (readonly Shape[])[] {
    const [type, ...restTypes] = types;
    if (type === undefined) {
      return rows.length === 0 ? [[]] : [];
    }
    const complete = this.#completeSignature(rows, type);
    if (complete === undefined) {
      const missingRest = this.missing(defaultRows(rows), restTypes);
      if (missingRest.length === 0) {
        return [];
      }
      const unlisted = this.#unlistedConstructor(rows, type);
      return missingRest.map((rest) => [unlisted, ...rest]);
    }
    const witnesses: (readonly Shape[])[] = [];
    for (const option of complete) {
      const arity = option.arguments.length;
      const below = this.missing(specialize(rows, option.key, arity), [
        ...option.arguments,
        ...restTypes,
      ]);
      for (const vector of below) {
        const built: ConstructorShape = {
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
    rows: readonly (readonly Shape[])[],
    type: T,
  ): readonly ConstructorOf<T>[] | undefined {
    const all = this.#signature(type);
    if (all === undefined) {
      return undefined;
    }
    const listed = headKeys(rows);
    return all.length > 0 && all.every(({ key }) => listed.has(key)) ? all : undefined;
  }

  /** A shape of a value of `type` that no row lists by its constructor. */
  #unlistedConstructor(rows: readonly (readonly Shape[])[], type: T): Shape {
    const listed = headKeys(rows);
    const unlisted = this.#signature(type)?.find(({ key }) => !listed.has(key));
    return unlisted === undefined || listed.size === 0
      ? anyShape
      : {
          kind: 'constructor',
          key: unlisted.key,
          arguments: unlisted.arguments.map(() => anyShape),
        };
  }

  /** The constructor `key` of `type`; for a type with no finite signature, one of `arity` unknowns. */
  #constructorOf(type: T, key: string, arity: number): ConstructorOf<T> {
    const found = this.#signature(type)?.find((option) => option.key === key);
    return found ?? { key, arguments: Array.from({ length: arity }, () => type) };
  }
}

/** The rows matching a value built by the constructor `key` of `arity`, its arguments laid out. */
function specialize(
  rows: readonly (readonly Shape[])[],
  key: string,
  arity: number,
): readonly (readonly Shape[])[] {
  return rows.flatMap((row) => {
    const [head, ...rest] = row;
    if (head === undefined) {
      return [];
    }
    if (head.kind === 'any') {
      return [[...Array.from({ length: arity }, () => anyShape), ...rest]];
    }
    return head.key === key ? [[...head.arguments, ...rest]] : [];
  });
}

/** The rows whose first column takes anything, without that column. */
function defaultRows(rows: readonly (readonly Shape[])[]): readonly (readonly Shape[])[] {
  return rows.flatMap(([head, ...rest]) => (head?.kind === 'any' ? [rest] : []));
}

function headKeys(rows: readonly (readonly Shape[])[]): ReadonlySet<string> {
  return new Set(rows.flatMap(([head]) => (head?.kind === 'constructor' ? [head.key] : [])));
}
