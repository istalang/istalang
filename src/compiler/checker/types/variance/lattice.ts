/**
 * Where a type parameter is met, as a lattice (§3.5): `unused ⊏ covariant, contravariant ⊏
 * invariant`, joined where it is met twice, flipped across a function type's parameter, and
 * composed through a declaration's own variance where it stands in that declaration's type
 * arguments. `unused` flips to itself, so a fixpoint rising from it ends (variance.ts).
 */

/** How a declaration's instantiations relate at one of its type parameters (§3.5). */
export type Variance = 'covariant' | 'contravariant' | 'invariant';

/** Where a parameter was met so far: nowhere, or as a variance. */
export type Usage = 'unused' | Variance;

/** The join of two usages: the least one both are below. */
export function joined(first: Usage, second: Usage): Usage {
  if (first === second || second === 'unused') {
    return first;
  }
  return first === 'unused' ? second : 'invariant';
}

/** Where a position stands inside one at `outer`, when the declaration there makes it `inner`. */
export function composed(outer: Variance, inner: Usage): Usage {
  switch (inner) {
    case 'unused':
      return 'unused';
    case 'covariant':
      return outer;
    case 'contravariant':
      return flipped(outer);
    default:
      return 'invariant';
  }
}

/** A usage seen from the other side of a function's parameter. */
export function flipped<Seen extends Usage>(usage: Seen): (typeof flips)[Seen] {
  return flips[usage];
}

const flips = {
  unused: 'unused',
  covariant: 'contravariant',
  contravariant: 'covariant',
  invariant: 'invariant',
} as const satisfies Record<Usage, Usage>;
