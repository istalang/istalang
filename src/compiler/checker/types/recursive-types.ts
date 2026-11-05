/**
 * Building recursive types (§3.17): `closeRecursive` is the one constructor of a recursive type's
 * graph, so every graph is minimized and every equal pair of recursive types is one type by key,
 * however the aliases writing them are named or nested (equi-recursive identity).
 *
 * - A group of alias bodies closes together: each body resolved with a placeholder wherever a use
 *   of the group's aliases stands (declarations/recursive-bodies.ts). Their term graph is minimized
 *   (recursive-terms.ts), and each class holding a body, or a node of another graph a body reached,
 *   becomes a node: its body rebuilt from its representative term, a node's own type wherever a
 *   node is reached again, any other class rebuilt in place. So a graph refers to no other graph,
 *   and its parts hold no recursive type (type-children.ts).
 * - A recursive alias in a union is flattened: its members join the union, as a union member's do.
 * - A node is labelled with the alias it reads as: the group's own alias holding it, else the label
 *   of the node it copied; one made only to break a cycle has none. A label identifies nothing.
 * - A recursive type's parts replaced (substitution, `mapRecursive`) closes its graph again from its
 *   nodes' bodies, each node's own type standing as a placeholder for it, so substituting then
 *   closing and closing then substituting give one type.
 * - `folded` gives the labelled recursive type a type holding recursion is equal to, when a graph
 *   it reaches has one, so a union naming a recursive alias's members, or a recursive member with more of its
 *   members, reads as that alias.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { RecursiveGraph, RecursiveType } from './computed-types.ts';
import { type Slot, TermGraph } from './recursive-terms.ts';
import type { DeclaredAliasUse, Type } from './type.ts';
import {
  graphParts,
  holdsRecursion,
  namesNodeOf,
  typeChildren,
  withTypeChildren,
} from './type-children.ts';
import { typeKeys } from './type-keys.ts';

/** A group of bodies closing together, and what each one reads as. */
export interface RecursiveGroup {
  /** Each body, a placeholder wherever a body of the group is reached again. */
  readonly bodies: readonly Type[];
  /** The index of the body the placeholder `type` stands for; undefined for any other type. */
  readonly placeholderOf: (type: Type) => number | undefined;
  /** The alias each body is written as, if any. */
  readonly labels: readonly (DeclaredAliasUse | undefined)[];
}

/** The type each of `group`'s bodies closes to (the banner), in order. */
export function closeRecursive(group: RecursiveGroup): readonly Type[] {
  const terms = new TermGraph({
    bodies: group.bodies,
    placeholderOf: group.placeholderOf,
    leafKey: (type) => typeKeys.typeKey(type),
    spell: (type, partKey) => typeKeys.structureKey(type, partKey),
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

/** Which classes of a minimized term graph become a graph's nodes, and the graph they build. */
class GraphNodes {
  readonly #terms: TermGraph;
  readonly #nodeOfClass = new Map<number, number>();
  readonly #representatives: number[] = [];
  readonly #labels: (DeclaredAliasUse | undefined)[] = [];

  constructor(terms: TermGraph) {
    this.#terms = terms;
  }

  /**
   * Makes the class `slot` leads to a node, labelled `label`, unless it is one already or reaches
   * itself through no cycle: a body that closes no cycle, or holds only others', is finite, and
   * rebuilds in place, so a recursive type always unfolds without end and never keys as a finite one.
   */
  name(slot: Slot, label: DeclaredAliasUse | undefined): void {
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
  build(roots: readonly Slot[]): readonly Type[] {
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
    return roots.map(typeOfSlot);
  }
}

/**
 * The recursive type `type` with each of its graph's parts replaced by what `map` gives, closed
 * again (the banner); `type` itself when `map` changes none.
 */
export function mapRecursive(type: RecursiveType, map: (part: Type) => Type): Type {
  const { graph } = type;
  const mapped = new Map(graphParts(graph).map((part) => [part, map(part)] as const));
  if ([...mapped].every(([part, replaced]) => part === replaced)) {
    return type;
  }
  const remapped = (each: Type): Type => {
    if (each.kind === 'recursive' && each.graph === graph) {
      return each;
    }
    const replaced = mapped.get(each);
    if (replaced !== undefined) {
      return replaced;
    }
    return namesNodeOf(each, graph)
      ? rebuiltFrom(each, typeChildren(each).map(remapped))
      : map(each);
  };
  const bodies = graph.nodes.map((body) => rebuiltFrom(body, typeChildren(body).map(remapped)));
  const labels = graph.labels.map((label) =>
    label === undefined ? undefined : { ...label, arguments: label.arguments.map(map) },
  );
  const closed = closeRecursive({
    bodies,
    placeholderOf: (each) =>
      each.kind === 'recursive' && each.graph === graph ? each.node : undefined,
    labels,
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
