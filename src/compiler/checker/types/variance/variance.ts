/**
 * Variance (§8.1): how the instantiations of a declaration relate, one answer per type parameter.
 * `X<A>` fits `X<B>` where its parameter is covariant and `A` fits `B`, contravariant and `B` fits
 * `A`, or invariant and the two are the same type (types/fitting/fit/index.ts).
 *
 * - A struct's or an enum's is derived from where each parameter occurs in what its values hold:
 *   a field is covariant, a function type's parameter flips the direction, an `any` type's
 *   constraints compose by their traits' variance, and a handle's type arguments, a `&` and a
 *   computed type (`T.Data`, `S[K]`, `keyof S`, a mapped type, a type `match`, which may map `Int`
 *   and `Int?` to unrelated types) make it invariant. A member parameter (`K in U`) is invariant,
 *   since each member is its own instantiation and `U` is none.
 * - A trait's is derived alike, by C#'s rule for interfaces, from its requirements, each the
 *   function type a call through `any` makes (its receiver, `Self`, no parameter of its own), and
 *   its required fields, which a value of an `any` type gives and never takes. A value inside an
 *   `any` type keeps its own type, so it can't be rebuilt at a wider argument as an `Array` can:
 *   what a trait gives may only be given, and what it takes only taken.
 * - A recursive declaration, or several referring to each other, is solved as one fixpoint over
 *   `unused ⊏ covariant, contravariant ⊏ invariant`, starting at `unused`, which flips to itself;
 *   a parameter still `unused` is then settled covariant and the fixpoint goes on (`solvedVariances`).
 * - An alias has its body's variance, derived alike, though fitting never asks: it is the type it
 *   names.
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
import type { RecursiveGraph } from '../type/computed-types.ts';
import type { AwaitedType } from '../type/function-types.ts';
import type { NominalDeclaration, Type } from '../type/index.ts';
import { joined, type Usage, type Variance } from './lattice.ts';
import { UsageWalk } from './usage-walk.ts';

/** What deriving a declaration's variance reads of the program. */
interface VarianceReading {
  /**
   * What a struct's, an enum's or an alias's values hold, in terms of its own type parameters: a
   * struct's fields, every variant's fields, the type an alias names; a trait's requirements, each
   * as the function type a call through `any` makes, its receiver apart, and its required fields.
   */
  readonly partsOf: (declaration: DerivedDeclaration) => readonly HeldPart[];
  /** `T` when `type` is `Future<T>`, which a function giving it varies in as in `T` (usage-walk.ts). */
  readonly awaitedOf: (type: Type) => AwaitedType | undefined;
}

/**
 * A type a declaration's values hold, at the variance it stands at there: a field's covariant; a
 * receiver's, the value itself, invariant, since a call through `any` never converts it.
 */
export interface HeldPart {
  readonly type: Type;
  readonly at: Variance;
}

/** A declaration whose type parameters have a variance. */
export type VariedDeclaration = NominalDeclaration | TypeAliasDeclaration | TraitDeclaration;

/** A declaration whose variance is derived from what its values hold, or a trait's requirements. */
export type DerivedDeclaration =
  | StructDeclaration
  | EnumDeclaration
  | TypeAliasDeclaration
  | TraitDeclaration;

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
  return isDerived(declaration)
    ? solvedVariances(declaration, reading)
    : parameters.map((parameter) => writtenVariance(declaration, parameter));
}

/** Whether `declaration`'s variance is derived from what its values hold. */
export function isDerived(declaration: VariedDeclaration): declaration is DerivedDeclaration {
  return (
    declaration.kind === 'StructDeclaration' ||
    declaration.kind === 'EnumDeclaration' ||
    declaration.kind === 'TypeAliasDeclaration' ||
    declaration.kind === 'TraitDeclaration'
  );
}

/** An extern's written variance, or a handle's: invariant. */
function writtenVariance(declaration: NominalDeclaration, parameter: TypeParameter): Variance {
  if (isHandleDeclaration(declaration) || parameter.variance === undefined) {
    return 'invariant';
  }
  return markerVariances[parameter.variance];
}

/**
 * A derived declaration a fixpoint solves: its parameters, its parts, the generic derived
 * declarations those hold, and its usages so far.
 */
interface Solved {
  readonly parameters: readonly TypeParameter[];
  readonly parts: readonly HeldPart[];
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
    settleGroup(solving, members, reading);
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
function settleGroup(
  solving: Solving,
  group: readonly Solved[],
  reading: Pick<VarianceReading, 'awaitedOf'>,
): void {
  converge(solving, group, reading);
  for (let unused = unusedIn(group); unused.length > 0; unused = unusedIn(group)) {
    const absent = unused.filter(({ solved, index }) => !occurs(solved, index));
    for (const { solved, index } of absent.length > 0 ? absent : unused) {
      solved.usages[index] = 'covariant';
    }
    converge(solving, group, reading);
  }
}

/** Raises each usage of `group` to what its parts make of it, until nothing changes. */
function converge(
  solving: Solving,
  group: readonly Solved[],
  reading: Pick<VarianceReading, 'awaitedOf'>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const solved of group) {
      const met = usagesIn(solving, solved, reading);
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
  return solved.parts.some(({ type }) =>
    parametersIn(type).some((mentioned) => mentioned === parameter),
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
    for (const held of derivedHeld(type)) {
      holds.push(held);
      reach(solving, held, reading);
    }
    const inside =
      type.kind === 'recursive' ? graphNodesOnce(reached, type.graph) : typeChildren(type);
    for (const child of inside) {
      visit(child);
    }
  };
  for (const { type } of parts) {
    visit(type);
  }
}

/**
 * The generic derived declarations `type` is an instance of at its top: a struct's, an enum's or an
 * alias's, or the traits an `any` type's constraints name. One of no type parameters mentions none
 * of another's.
 */
function derivedHeld(type: Type): readonly DerivedDeclaration[] {
  if (type.kind === 'any') {
    return type.constraints.flatMap(({ trait, arguments: given }) =>
      given.length > 0 ? [trait] : [],
    );
  }
  return type.kind === 'nominal' && type.arguments.length > 0 && isDerived(type.entity.declaration)
    ? [type.entity.declaration]
    : [];
}

/** Where a declaration's parameters are met in its parts, by the usages known so far. */
function usagesIn(
  solving: Solving,
  { parameters, parts }: Solved,
  { awaitedOf }: Pick<VarianceReading, 'awaitedOf'>,
): Usage[] {
  const walk = new UsageWalk(parameters, (reached) => usagesSoFar(solving, reached), awaitedOf);
  for (const { type, at } of parts) {
    walk.walk(type, at);
  }
  return walk.usages;
}

/** The usages of `declaration`'s parameters as known so far: derived ones solving, others fixed. */
function usagesSoFar(solving: Solving, declaration: VariedDeclaration): readonly Usage[] {
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
