/**
 * Variance (§3.5): how the instantiations of a declaration relate, one answer per type parameter.
 * `X<A>` fits `X<B>` where its parameter is covariant and `A` fits `B`, contravariant and `B` fits
 * `A`, or invariant and the two are the same type (types/fitting/fit/index.ts).
 *
 * - A struct's or an enum's is derived from where each parameter occurs in what its values hold:
 *   a field is covariant, a function type's parameter flips the direction, and a handle's type
 *   arguments, a `&`, an `any` type's constraints (until traits have variance) and a computed type
 *   (`T.Data`, `S[K]`, `keyof S`, a mapped type, a type `match`, which may map `Int` and `Int?` to
 *   unrelated types) make it invariant. A member parameter (`K in U`) is invariant, since each
 *   member is its own instantiation and `U` is none.
 * - A recursive declaration, or several referring to each other, is solved as one fixpoint over
 *   `unused ⊏ covariant, contravariant ⊏ invariant`, starting at `unused`, which flips to itself;
 *   a parameter still `unused` is then settled covariant and the fixpoint goes on (`solvedVariances`).
 * - An alias has its body's variance, derived alike, though fitting never asks: it is the type it
 *   names. A trait's is invariant until it is derived for `any` (phase V2).
 * - An extern value's is written (`gives` covariant, `takes` contravariant, none invariant): the
 *   runtime's promise that it rebuilds a value at a wider argument. A handle's is invariant, since
 *   a value put in through one copy is read through every other (until view handles, tracker F27).
 * - A variance written on a struct or an enum only asserts the derived one, which
 *   checkVarianceMarkers holds it to.
 */

import { addToGroup } from '../../../../foundation/structures/groups.ts';
import { stronglyConnected } from '../../../../foundation/structures/strongly-connected.ts';
import {
  type EnumDeclaration,
  type StructDeclaration,
  type TraitDeclaration,
  type TypeAliasDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { VarianceMarker } from '../../../syntax/tokens/grammar-words.ts';
import { typeChildren } from '../parts/type-children.ts';
import { parametersIn } from '../parts/type-parts.ts';
import { isHandleDeclaration } from '../properties/handles.ts';
import {
  type RecursiveGraph,
  type RecursiveType,
  unfoldRecursive,
} from '../type/computed-types.ts';
import type {
  FunctionType,
  NominalDeclaration,
  NominalType,
  Type,
  TypeParameterType,
} from '../type/index.ts';

export type Variance = 'covariant' | 'contravariant' | 'invariant';

/** Where a parameter was met so far: nowhere, or as a variance. */
type Usage = 'unused' | Variance;

/** What deriving a declaration's variance reads of the program. */
export interface VarianceReading {
  /**
   * The types a struct's, an enum's or an alias's values hold, in terms of its own type
   * parameters: a struct's fields, every variant's fields, the type an alias names.
   */
  readonly partsOf: (declaration: DerivedDeclaration) => readonly Type[];
}

/** A declaration whose type parameters have a variance. */
export type VariedDeclaration = NominalDeclaration | TypeAliasDeclaration | TraitDeclaration;

/** A declaration whose variance is derived from what its values hold. */
export type DerivedDeclaration = StructDeclaration | EnumDeclaration | TypeAliasDeclaration;

/** The variance each word writes. */
export const markerVariances = {
  gives: 'covariant',
  takes: 'contravariant',
} as const satisfies Record<VarianceMarker, Variance>;

/** The variance of each of `declaration`'s type parameters, in order. */
export function varianceOf(
  declaration: VariedDeclaration,
  reading: VarianceReading,
): readonly Variance[] {
  const parameters = typeParametersOf(declaration.typeParameters);
  if (parameters.length === 0) {
    return [];
  }
  if (declaration.kind === 'TraitDeclaration') {
    // Derived where a trait is used through `any`, which converts nothing yet (tracker: V2).
    return parameters.map(() => 'invariant');
  }
  return isDerived(declaration)
    ? solvedVariances(declaration, reading)
    : parameters.map((parameter) => writtenVariance(declaration, parameter));
}

/** Whether `declaration`'s variance is derived from what its values hold. */
export function isDerived(declaration: VariedDeclaration): declaration is DerivedDeclaration {
  return (
    declaration.kind === 'StructDeclaration' ||
    declaration.kind === 'EnumDeclaration' ||
    declaration.kind === 'TypeAliasDeclaration'
  );
}

/** An extern's written variance, or a handle's: invariant. */
function writtenVariance(declaration: NominalDeclaration, parameter: TypeParameter): Variance {
  if (isHandleDeclaration(declaration) || parameter.variance === undefined) {
    return 'invariant';
  }
  return markerVariances[parameter.variance];
}

/** The join of two usages: the least one both are below. */
function joined(first: Usage, second: Usage): Usage {
  if (first === second || second === 'unused') {
    return first;
  }
  return first === 'unused' ? second : 'invariant';
}

const flips = {
  unused: 'unused',
  covariant: 'contravariant',
  contravariant: 'covariant',
  invariant: 'invariant',
} as const satisfies Record<Usage, Usage>;

/** A usage seen from the other side of a function's parameter. */
function flipped<Seen extends Usage>(usage: Seen): (typeof flips)[Seen] {
  return flips[usage];
}

/** Where a position stands inside one at `outer`, when the declaration there makes it `inner`. */
function composed(outer: Variance, inner: Usage): Usage {
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

/**
 * A derived declaration a fixpoint solves: its parameters, its parts, the generic derived
 * declarations those hold, and its usages so far.
 */
interface Solved {
  readonly parameters: readonly TypeParameter[];
  readonly parts: readonly Type[];
  readonly holds: readonly DerivedDeclaration[];
  usages: Usage[];
}

/** The derived declarations a fixpoint solves. */
type Solving = Map<DerivedDeclaration, Solved>;

/**
 * The variances of `root`'s parameters, solved with every derived declaration its values reach,
 * group by group of declarations holding each other, those a group holds solved before it. A
 * group's fixpoint rises from `unused` (a member parameter starting invariant); what is still
 * `unused` once it converges is then settled covariant and the fixpoint goes on from there, so the
 * result is one: wherever `X<A>` fits `X<B>`, each part of the one fits the other's, as lowering
 * rebuilds it (lowering/functions/fits/parts.ts). A group is settled before what holds it, so
 * `struct Phantom<T> { n: Int }`, and `struct List<T> { next: List<T>? }`, make
 * `fn(Phantom<T>) -> Unit` and `fn(List<T>) -> Unit` contravariant in `T`. Within a group, a
 * parameter occurring nowhere settles first; one met only through the group itself settles last,
 * and may rise again: `struct Loop<T> { f: fn(Loop<T>) -> Unit }` is invariant. Each round settles
 * one parameter at least and the lattice has height two, so it ends.
 */
function solvedVariances(root: DerivedDeclaration, reading: VarianceReading): readonly Variance[] {
  const solving: Solving = new Map();
  reach(solving, root, reading);
  const edges = [...solving].flatMap(([from, { holds }]) => holds.map((to) => ({ from, to })));
  const groupOf = stronglyConnected(edges);
  const groups = new Map<DerivedDeclaration, Solved[]>();
  for (const [declaration, solved] of solving) {
    addToGroup(groups, groupOf(declaration) ?? declaration, solved);
  }
  const settled = new Set<DerivedDeclaration>();
  const settle = (group: DerivedDeclaration): void => {
    if (settled.has(group)) {
      return;
    }
    settled.add(group);
    const members = groups.get(group) ?? [];
    for (const held of members.flatMap(({ holds }) => holds)) {
      settle(groupOf(held) ?? held);
    }
    settleGroup(solving, members);
  };
  for (const group of groups.keys()) {
    settle(group);
  }
  const usages = solving.get(root)?.usages ?? [];
  return usages.map((usage) => (usage === 'unused' ? 'covariant' : usage));
}

/**
 * Settles one group of declarations holding each other, those it holds settled already: its
 * fixpoint, then its `unused` parameters settled covariant, those occurring nowhere first, and the
 * fixpoint again, until none is `unused`.
 */
function settleGroup(solving: Solving, group: readonly Solved[]): void {
  converge(solving, group);
  for (let unused = unusedIn(group); unused.length > 0; unused = unusedIn(group)) {
    const absent = unused.filter(({ solved, index }) => !occurs(solved, index));
    for (const { solved, index } of absent.length > 0 ? absent : unused) {
      solved.usages[index] = 'covariant';
    }
    converge(solving, group);
  }
}

/** Raises each usage of `group` to what its parts make of it, until nothing changes. */
function converge(solving: Solving, group: readonly Solved[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const solved of group) {
      const met = usagesIn(solving, solved);
      const next = solved.usages.map((usage, index) => joined(usage, met[index] ?? 'unused'));
      if (next.some((usage, index) => usage !== solved.usages[index])) {
        solved.usages = next;
        changed = true;
      }
    }
  }
}

/** Every parameter of `group` still `unused`, by its declaration. */
function unusedIn(
  group: readonly Solved[],
): readonly { readonly solved: Solved; readonly index: number }[] {
  return group.flatMap((solved) =>
    solved.usages.flatMap((usage, index) => (usage === 'unused' ? [{ solved, index }] : [])),
  );
}

/** Whether parameter `index` occurs anywhere in its declaration's parts. */
function occurs(solved: Solved, index: number): boolean {
  const parameter = solved.parameters[index];
  return solved.parts.some((part) =>
    parametersIn(part).some((mentioned) => mentioned === parameter),
  );
}

/** Adds `declaration`, and every derived declaration its values reach, at `unused`. */
function reach(solving: Solving, declaration: DerivedDeclaration, reading: VarianceReading): void {
  if (solving.has(declaration)) {
    return;
  }
  const parts = reading.partsOf(declaration);
  const parameters = typeParametersOf(declaration.typeParameters);
  // A member parameter is invariant whatever holds it: each member is its own instantiation.
  const usages = parameters.map(
    (parameter): Usage => (parameter.memberOf === undefined ? 'unused' : 'invariant'),
  );
  const holds: DerivedDeclaration[] = [];
  solving.set(declaration, { parameters, parts, holds, usages });
  const reached = new Set<RecursiveGraph>();
  const visit = (type: Type): void => {
    // A declaration of no type parameters mentions none of another's.
    if (
      type.kind === 'nominal' &&
      type.arguments.length > 0 &&
      isDerived(type.entity.declaration)
    ) {
      holds.push(type.entity.declaration);
      reach(solving, type.entity.declaration, reading);
    }
    const inside =
      type.kind === 'recursive' ? graphNodesOnce(reached, type.graph) : typeChildren(type);
    for (const child of inside) {
      visit(child);
    }
  };
  for (const part of parts) {
    visit(part);
  }
}

/** Where a declaration's parameters are met in its parts, by the usages known so far. */
function usagesIn(solving: Solving, { parameters, parts }: Solved): Usage[] {
  const walk = new UsageWalk(parameters, (reached) => usagesSoFar(solving, reached));
  for (const part of parts) {
    walk.walk(part, 'covariant');
  }
  return walk.usages;
}

/** The usages of `declaration`'s parameters as known so far: derived ones solving, others fixed. */
function usagesSoFar(solving: Solving, declaration: NominalDeclaration): readonly Usage[] {
  if (isDerived(declaration)) {
    // Each generic derived declaration reached is solving; a value holds no other's arguments.
    return solving.get(declaration)?.usages ?? [];
  }
  return typeParametersOf(declaration.typeParameters).map((parameter) =>
    writtenVariance(declaration, parameter),
  );
}

/** A recursive type's nodes, the first time its graph is met; none after. */
function graphNodesOnce(reached: Set<RecursiveGraph>, graph: RecursiveGraph): readonly Type[] {
  if (reached.has(graph)) {
    return [];
  }
  reached.add(graph);
  return graph.nodes;
}

/** One walk over a declaration's parts, noting where each of its parameters is met. */
class UsageWalk {
  readonly usages: Usage[];
  readonly #parameters: readonly TypeParameter[];
  readonly #variancesOf: (declaration: NominalDeclaration) => readonly Usage[];
  /** Each node of a recursive type is walked once per position it is met at. */
  readonly #walked = new Map<RecursiveGraph, Set<string>>();

  constructor(
    parameters: readonly TypeParameter[],
    variancesOf: (declaration: NominalDeclaration) => readonly Usage[],
  ) {
    this.#parameters = parameters;
    this.#variancesOf = variancesOf;
    this.usages = parameters.map(() => 'unused');
  }

  walk(type: Type, at: Variance): void {
    switch (type.kind) {
      case 'parameter':
        this.#meet(type.declaration, at);
        return;
      case 'nominal':
        this.#nominal(type, at);
        return;
      case 'function':
        this.#function(type, at);
        return;
      case 'recursive':
        this.#recursive(type, at);
        return;
      case 'anonymous':
      case 'tuple':
      case 'union':
        this.#each(typeChildren(type), at);
        return;
      default:
        // `any`'s constraints and computed types: no variance (yet, for `any`).
        this.#each(typeChildren(type), 'invariant');
    }
  }

  #meet(parameter: TypeParameterType['declaration'], at: Variance): void {
    const index = parameter.kind === 'TypeParameter' ? this.#parameters.indexOf(parameter) : -1;
    if (index >= 0) {
      this.usages[index] = joined(this.usages[index] ?? 'unused', at);
    }
  }

  #nominal(type: NominalType, at: Variance): void {
    const inner = this.#variancesOf(type.entity.declaration);
    type.arguments.forEach((argument, index) => {
      const position = composed(at, inner[index] ?? 'invariant');
      if (position !== 'unused') {
        this.walk(argument, position);
      }
    });
  }

  #function(type: FunctionType, at: Variance): void {
    for (const parameter of type.parameters) {
      this.walk(parameter.type, parameter.reference ? 'invariant' : flipped(at));
    }
    if (type.pack !== undefined) {
      this.walk(type.pack, flipped(at));
    }
    this.walk(type.result, at);
  }

  #recursive(type: RecursiveType, at: Variance): void {
    const positions = this.#walked.get(type.graph) ?? new Set<string>();
    this.#walked.set(type.graph, positions);
    const position = `${type.node}:${at}`;
    if (!positions.has(position)) {
      positions.add(position);
      this.walk(unfoldRecursive(type), at);
    }
  }

  #each(types: readonly Type[], at: Variance): void {
    for (const type of types) {
      this.walk(type, at);
    }
  }
}
