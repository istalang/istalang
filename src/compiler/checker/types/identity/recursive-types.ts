/**
 * Building recursive types (§3.17): `closeRecursive` is the one constructor of a recursive type's
 * graph, so every graph is minimized and every equal pair of recursive types is one type by key,
 * however the aliases writing them are named or nested (equi-recursive identity).
 *
 * - A group of alias bodies closes together: each body resolved with a placeholder wherever a use
 *   of the group's aliases stands (constructs/declarations/aliases/recursive-bodies.ts). Their term
 *   graph is minimized (recursive-terms.ts), and each class holding a body, or a node of another
 *   graph a body reached, becomes a node: its body rebuilt from its representative term, a node's
 *   own type wherever a node is reached again, any other class rebuilt in place. So a graph refers
 *   to no other graph, and its parts hold no recursive type (../parts/type-children.ts).
 * - A recursive alias in a union is flattened: its members join the union, as a union member's do.
 * - A computed type a body holds over a use of the group (a type `match` given it, say) stays
 *   unreduced while that use is a placeholder, which decides nothing. Once the group has closed,
 *   each one built from a node is reduced, joins the group as a body of its own, and the group
 *   closes again, so no graph keeps a computed type its own nodes decide (stage 2 of
 *   docs/work/proposals/p5-equi-recursive-identity.md).
 * - A node is labelled with the alias it reads as: the group's own alias holding it, else the label
 *   of the node it copied; one made only to break a cycle has none. A label identifies nothing.
 * - A recursive type's parts replaced (substitution, `mapRecursive`) closes its graph again from
 *   its nodes' bodies, each node's own type standing as a placeholder for it, so substituting then
 *   closing and closing then substituting give one type.
 * - `folded` gives the labelled recursive type a type holding recursion is equal to, when a graph
 *   it reaches has one, so a union naming a recursive alias's members, or a recursive member with
 *   more of its members, reads as that alias.
 */

import { sameItems } from '../../../../structures/equality.ts';
import { unreachable } from '../../../../structures/unreachable.ts';
import { isComputed, type RecursiveGraph, type RecursiveType } from '../computed-types.ts';
import { reducedComputed } from '../parts/computed-reduction.ts';
import {
  boundWithin,
  graphParts,
  graphPlaceOf,
  holdsRecursion,
  namesNodeOf,
  typeChildren,
  withTypeChildren,
} from '../parts/type-children.ts';
import { mapAliasUse, type RecursiveLabel } from '../type/alias-uses.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import type { TypeRules } from '../type-rules.ts';
import { type Slot, TermGraph } from './recursive-terms.ts';
import { typeKeys } from './type-keys.ts';

/** A group of bodies closing together, and what each one reads as. */
export interface RecursiveGroup {
  /** Each body, a placeholder wherever a body of the group is reached again. */
  readonly bodies: readonly Type[];
  /** The index of the body the placeholder `type` stands for; undefined for any other type. */
  readonly placeholderOf: (type: Type) => number | undefined;
  /** How each body reads: the alias, or associated type, it is written as, if any. */
  readonly labels: readonly (RecursiveLabel | undefined)[];
  /**
   * The rules of the program, which normalize unions the graph flattens
   * (../unions/union-members.ts) and reduce computed types built from its nodes
   * (../parts/computed-reduction.ts).
   */
  readonly rules: TypeRules;
}

/** The type each of `group`'s bodies closes to (the banner), in order. */
export function closeRecursive(group: RecursiveGroup): readonly Type[] {
  return withTermsReduced(closedOnce(group), group);
}

/** What a group closed to once: each body's type, and the graph closing built. */
interface Closed {
  readonly types: readonly Type[];
  readonly graph: RecursiveGraph;
}

/** How many computed types one closing reduces before it takes the rest as never reducing. */
const mostReducedTerms = 256;

/** `group` closed into one graph, its computed types left as its bodies hold them. */
function closedOnce(group: RecursiveGroup): Closed {
  const terms = new TermGraph({
    bodies: group.bodies,
    placeholderOf: group.placeholderOf,
    leafKey: (type) => typeKeys.typeKey(type),
    spell: (type, partKey) => typeKeys.structureKey(type, partKey),
    rules: group.rules,
  });
  const roots = group.bodies.map((_, index) => terms.bodySlot(index));
  terms.minimize();
  const nodes = new GraphNodes(terms);
  for (const [index, slot] of roots.entries()) {
    nodes.name(slot, group.labels[index]);
  }
  for (const { graph, node, term } of terms.imported) {
    nodes.name({ kind: 'term', term }, graph.labels[node]);
  }
  nodes.breakCycles(roots);
  return nodes.build(roots);
}

/**
 * What `closed` closes to with each computed type built from its graph's nodes reduced (the
 * banner): a body resolves with placeholders, which decide no type `match` given one, say, so it
 * stays unreduced until the placeholder is a node. Each reduced one joins the group as a body of
 * its own, so a reduction reaching it again closes a cycle through it, and the group closes again
 * with the graph's nodes and the bodies that are none.
 */
function withTermsReduced(closed: Closed, group: RecursiveGroup): readonly Type[] {
  const { graph, types } = closed;
  if (graph.nodes.length === 0) {
    return types;
  }
  const others = [...types.entries()].filter(([, type]) => !isNodeOf(type, graph));
  const reductions = new Map<string, Type>();
  const stuck = new Set<string>();
  const pending = [...graph.nodes, ...others.map(([, type]) => type)].flatMap((type) =>
    termsOver(type, graph),
  );
  for (
    let term = pending.pop();
    term !== undefined && reductions.size < mostReducedTerms;
    term = pending.pop()
  ) {
    const key = typeKeys.typeKey(term);
    if (!(reductions.has(key) || stuck.has(key))) {
      const reduced = reducedOver(term, graph, group.rules);
      if (typeKeys.typeKey(reduced) === key) {
        stuck.add(key);
      } else {
        reductions.set(key, reduced);
        pending.push(...termsOver(reduced, graph));
      }
    }
  }
  if (reductions.size === 0) {
    return types;
  }
  const firstReduction = graph.nodes.length + others.length;
  const indexOfTerm = new Map([...reductions.keys()].map((key, at) => [key, firstReduction + at]));
  const again = closedOnce({
    bodies: [...graph.nodes, ...others.map(([, type]) => type), ...reductions.values()],
    placeholderOf: (type) => {
      if (isNodeOf(type, graph)) {
        return type.node;
      }
      return isComputed(type) ? indexOfTerm.get(typeKeys.typeKey(type)) : undefined;
    },
    labels: [
      ...graph.labels,
      ...others.map(([index]) => group.labels[index]),
      ...[...reductions.keys()].map(() => undefined),
    ],
    rules: group.rules,
  }).types;
  const indexOfOther = new Map(others.map(([index], at) => [index, graph.nodes.length + at]));
  return types.map(
    (type, index) =>
      again[isNodeOf(type, graph) ? type.node : (indexOfOther.get(index) ?? -1)] ??
      unreachable('A body closed to nothing.'),
  );
}

/** Whether `type` is a node of `graph`. */
function isNodeOf(type: Type, graph: RecursiveGraph): type is RecursiveType {
  return type.kind === 'recursive' && type.graph === graph;
}

/** The outermost computed types in `type` built from a node of `graph`. */
function termsOver(type: Type, graph: RecursiveGraph): readonly Type[] {
  if (type.kind === 'recursive' || !holdsRecursion(type)) {
    return [];
  }
  if (isComputed(type) && namesNodeOf(type, graph)) {
    return [type];
  }
  return typeChildren(type).flatMap((child) => termsOver(child, graph));
}

/** `type` with every computed type in it built from a node of `graph` reduced, innermost first. */
function reducedOver(type: Type, graph: RecursiveGraph, rules: TypeRules): Type {
  if (type.kind === 'recursive' || !holdsRecursion(type)) {
    return type;
  }
  const children = typeChildren(type);
  const reduced = children.map((child) => reducedOver(child, graph, rules));
  const rebuilt = reduced.every((child, at) => child === children[at])
    ? type
    : withTypeChildren(type, reduced);
  return isComputed(rebuilt) && namesNodeOf(rebuilt, graph)
    ? reducedComputed(rebuilt, (child) => child, rules)
    : rebuilt;
}

/** Which classes of a minimized term graph become a graph's nodes, and the graph they build. */
class GraphNodes {
  readonly #terms: TermGraph;
  readonly #nodeOfClass = new Map<number, number>();
  readonly #representatives: number[] = [];
  readonly #labels: (RecursiveLabel | undefined)[] = [];

  constructor(terms: TermGraph) {
    this.#terms = terms;
  }

  /**
   * Makes the class `slot` leads to a node, labelled `label`, unless it is one already or reaches
   * itself through no cycle: a body that closes no cycle, or holds only others', is finite, and
   * rebuilds in place, so a recursive type always unfolds without end and never keys as a finite
   * one.
   */
  name(slot: Slot, label: RecursiveLabel | undefined): void {
    const resolved = this.#terms.resolved(slot);
    if (resolved.kind === 'leaf' || !this.#reachesItself(resolved.term)) {
      return;
    }
    const rank = this.#terms.classOf(resolved.term);
    if (!this.#nodeOfClass.has(rank)) {
      this.#nodeOfClass.set(rank, this.#representatives.length);
      this.#representatives.push(resolved.term);
      this.#labels.push(label);
    }
  }

  /** Whether the class of `term` is reached again from its parts. */
  #reachesItself(term: number): boolean {
    const own = this.#terms.classOf(term);
    const seen = new Set<number>();
    const pending = [term];
    for (let each = pending.pop(); each !== undefined; each = pending.pop()) {
      for (const part of this.#terms.partsOf(each)) {
        if (part.kind === 'term') {
          const rank = this.#terms.classOf(part.term);
          if (rank === own) {
            return true;
          }
          if (!seen.has(rank)) {
            seen.add(rank);
            pending.push(part.term);
          }
        }
      }
    }
    return false;
  }

  /**
   * Makes a node, unlabelled, of each class a cycle through no node comes back to, so every cycle
   * passes a node and every other class rebuilds in place. Flattening can leave such a cycle: in
   * `type R = Int | Array<R?>`, `R?` holds `R`'s members, so it reaches itself without `R`.
   */
  breakCycles(roots: readonly Slot[]): void {
    const entered = new Set<number>();
    const finished = new Set<number>();
    const visit = (term: number): void => {
      for (const part of this.#terms.partsOf(term)) {
        const rank = part.kind === 'term' ? this.#terms.classOf(part.term) : undefined;
        const open =
          part.kind === 'term' &&
          rank !== undefined &&
          !this.#nodeOfClass.has(rank) &&
          !finished.has(rank);
        if (open && entered.has(rank)) {
          this.name(part, undefined);
        } else if (open) {
          entered.add(rank);
          visit(part.term);
          entered.delete(rank);
          finished.add(rank);
        }
      }
    };
    const starts = roots.flatMap((slot) => {
      const resolved = this.#terms.resolved(slot);
      return resolved.kind === 'term' ? [resolved.term] : [];
    });
    for (const term of [...this.#representatives, ...starts]) {
      const rank = this.#terms.classOf(term);
      if (!finished.has(rank)) {
        entered.add(rank);
        visit(term);
        entered.delete(rank);
        finished.add(rank);
      }
    }
  }

  /** The graph of the named classes, and the type each of `roots` closes to. */
  build(roots: readonly Slot[]): Closed {
    const terms = this.#terms;
    const nodes: Type[] = [];
    const types: RecursiveType[] = [];
    const labels = this.#labels;
    const graph: RecursiveGraph = { nodes, types, labels };
    for (const [node, label] of labels.entries()) {
      types.push({ kind: 'recursive', graph, node, alias: label });
    }
    const typeOfSlot = (slot: Slot): Type => {
      const resolved = terms.resolved(slot);
      if (resolved.kind === 'leaf') {
        return resolved.type;
      }
      const node = this.#nodeOfClass.get(terms.classOf(resolved.term));
      return node === undefined
        ? rebuilt(resolved.term)
        : (types[node] ?? unreachable('A node has no type.'));
    };
    const rebuilt = (term: number): Type =>
      rebuiltFrom(terms.typeOf(term), terms.partsOf(term).map(typeOfSlot));
    for (const term of this.#representatives) {
      nodes.push(rebuilt(term));
    }
    return { types: roots.map(typeOfSlot), graph };
  }
}

/**
 * The recursive type `type` with each of its graph's parts and the types its labels name replaced
 * by what `map` gives, closed again by the program's `rules` (the banner); `type` itself when `map`
 * changes none. A label is how its node is written, never one of its parts, as an alias a type is
 * written through is (../type/index.ts), so a parameter only a label names, `T` of `Phantom<T> =
 * Int | Array<Phantom<T>>`, is replaced in the label alone.
 */
export function mapRecursive(
  type: RecursiveType,
  map: (part: Type) => Type,
  rules: TypeRules,
): Type {
  const { graph } = type;
  const mapped = new Map(graphParts(graph).map((part) => [part, map(part)] as const));
  const labels = graph.labels.map((label) => label && mapAliasUse(label, map));
  if (
    [...mapped].every(([part, replaced]) => part === replaced) &&
    sameItems<RecursiveLabel | undefined>()(labels, graph.labels)
  ) {
    return type;
  }
  const remapped = (each: Type, bound: ReadonlySet<ParameterKey>): Type => {
    switch (graphPlaceOf(each, graph, bound)) {
      case 'part':
        return mapped.get(each) ?? map(each);
      case 'built':
        return rebuiltWithin(each, bound);
      default:
        return each;
    }
  };
  const rebuiltWithin = (each: Type, bound: ReadonlySet<ParameterKey>): Type => {
    const inner = boundWithin(each, bound);
    return rebuiltFrom(
      each,
      typeChildren(each).map((child) => remapped(child, inner)),
    );
  };
  const bodies = graph.nodes.map((body) => rebuiltWithin(body, new Set()));
  const closed = closeRecursive({
    bodies,
    placeholderOf: (each) =>
      each.kind === 'recursive' && each.graph === graph ? each.node : undefined,
    labels,
    rules,
  });
  const result = closed[type.node] ?? unreachable('A node closed to nothing.');
  return type.alias === undefined ? result : { ...result, alias: type.alias };
}

/** `type` rebuilt from `children`, a union as the set of them, which closing normalizes. */
function rebuiltFrom(type: Type, children: readonly Type[]): Type {
  return type.kind === 'union'
    ? { kind: 'union', members: children }
    : withTypeChildren(type, children);
}

/** The recursive type equal to `type` among the nodes of the graphs it reaches (the banner). */
export function folded(type: Type): Type {
  if (type.kind === 'recursive' || !holdsRecursion(type)) {
    return type;
  }
  const key = typeKeys.typeKey(type);
  for (const graph of graphsIn(type)) {
    const equal = graph.types.find(
      (node) => node.alias !== undefined && typeKeys.typeKey(node) === key,
    );
    if (equal !== undefined) {
      return type.alias === undefined ? equal : { ...equal, alias: type.alias };
    }
  }
  return type;
}

/** The graphs of the recursive types `type` is or is built from. */
function graphsIn(type: Type): ReadonlySet<RecursiveGraph> {
  const graphs = new Set<RecursiveGraph>();
  const visit = (each: Type): void => {
    if (each.kind === 'recursive') {
      graphs.add(each.graph);
    } else if (holdsRecursion(each)) {
      typeChildren(each).forEach(visit);
    }
  };
  visit(type);
  return graphs;
}
