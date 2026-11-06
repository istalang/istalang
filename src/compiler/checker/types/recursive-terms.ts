/**
 * The term graph of types holding recursion (§3.17), minimized: what equi-recursive identity is
 * decided on. Closing a group of alias bodies (recursive-types.ts) and keying a type holding a
 * recursive type (type-keys.ts) both build one here, so a recursive type's graph and its key agree
 * by construction.
 *
 * - A term is a type holding recursion: a placeholder (a group alias's own use, standing for its
 *   body), a node of a recursive type's graph, reached through that type, or a type built from
 *   either. A type holding none is a leaf, keyed as any type is.
 * - A union's members are a set: a member that is a union term, or a leaf union, gives its members
 *   (flattening, which equi-recursion makes a recursive alias in a union do), and they are then
 *   normalized as every union's are (union-members.ts), by the rules the source gives; a union of
 *   one member is that member.
 * - Minimizing is partition refinement (term-signatures.ts): terms start in classes by their own
 *   structure (kind, field names, entity, arity), then split by their parts' classes, a union being
 *   the set of its members', until no class splits; a union left with one member's class is that
 *   member. Each class's rank orders it by its unfolding to the depth that split it, a canonical
 *   order however the graph was written, so numbering classes from a root in that order spells a
 *   canonical key: two roots have one key exactly when their unfoldings are equal.
 * - Keys are passed in (`TermSource`): this unit sits below type-keys.ts, which keys leaves and
 *   spells a term's own structure around its parts' spellings.
 * - Keying a type (`canonicalKey`) takes no program's rules: every union it reaches was normalized
 *   where it was built, recursive members flattened, so none takes another member whole again.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { RecursiveGraph } from './computed-types.ts';
import { errorType, neverType } from './primitives.ts';
import { compareSignatures, refinedRanks, type Signature } from './term-signatures.ts';
import type { Type } from './type.ts';
import { holdsRecursion, typeChildren } from './type-children.ts';
import { type MemberReading, type MemberRules, normalizedMembers } from './union-members.ts';

/** Where a part of a term leads: a type holding no recursion, with its key, or a term. */
export type Slot =
  | { readonly kind: 'leaf'; readonly type: Type; readonly key: string }
  | { readonly kind: 'term'; readonly term: number };

/** What a term graph is built from and keyed by. */
export interface TermSource {
  /** The bodies placeholders stand for: a group's own, empty when keying a type. */
  readonly bodies: readonly Type[];
  /** The index of the body the placeholder `type` stands for; undefined for any other type. */
  readonly placeholderOf: (type: Type) => number | undefined;
  /** The key of a type holding no recursion. */
  readonly leafKey: (type: Type) => string;
  /** The key of `type`'s own structure, each of its parts spelled by `partKey`. */
  readonly spell: (type: Type, partKey: (part: Type) => string) => string;
  /** The rules a union's members are normalized by. */
  readonly rules: MemberRules;
}

/** A term: the type it stands for, and where its parts lead, a union's members flattened. */
interface Term {
  readonly type: Type;
  parts: readonly Slot[];
}

/** A node of a recursive type's graph reached while building, as the term it became. */
export interface ImportedNode {
  readonly graph: RecursiveGraph;
  readonly node: number;
  readonly term: number;
}

/** How many times a union may stand for its one member in a row before the chain is a cycle. */
const deepestRedirect = 1024;

export class TermGraph {
  readonly #source: TermSource;
  readonly #terms: Term[] = [];
  readonly #ofType = new Map<Type, Slot>();
  readonly #bodies: (Slot | undefined)[] = [];
  readonly #entering = new Set<number>();
  readonly #nodes = new Map<RecursiveGraph, (Slot | undefined)[]>();
  readonly #imported: ImportedNode[] = [];
  readonly #holdsPlaceholder = new Map<Type, boolean>();
  /** Unions standing for one slot: their one member, `Never` or the error type. */
  readonly #redirects = new Map<number, Slot>();
  #ranks: number[] = [];

  constructor(source: TermSource) {
    this.#source = source;
  }

  /** The nodes of other graphs reached, in the order first reached. */
  get imported(): readonly ImportedNode[] {
    return this.#imported;
  }

  /** Where `type` leads, built on demand. */
  slotOf(type: Type): Slot {
    const placeholder = this.#source.placeholderOf(type);
    if (placeholder !== undefined) {
      return this.bodySlot(placeholder);
    }
    if (type.kind === 'recursive') {
      return this.#nodeSlot(type.graph, type.node);
    }
    if (!this.#isTerm(type)) {
      return { kind: 'leaf', type, key: this.#source.leafKey(type) };
    }
    const known = this.#ofType.get(type);
    if (known !== undefined) {
      return known;
    }
    const term = this.#terms.push({ type, parts: [] }) - 1;
    const slot: Slot = { kind: 'term', term };
    this.#ofType.set(type, slot);
    const parts = typeChildren(type).map((part) => this.slotOf(part));
    this.#termAt(term).parts = parts;
    return slot;
  }

  /** Where body `index` leads: where the body it forwards to does. */
  bodySlot(index: number): Slot {
    const known = this.#bodies[index];
    if (known !== undefined) {
      return known;
    }
    const forwarded = this.#forwardedBody(index);
    if (forwarded === undefined) {
      // Bodies each only standing for the next, around a cycle, name no type, which declarations
      // report (declarations/alias-recursion.ts).
      return this.#leaf(errorType);
    }
    const body = this.#source.bodies[forwarded] ?? errorType;
    if (this.#entering.has(forwarded)) {
      // Reached again from inside: the body's own term, made before its parts.
      return this.#ofType.get(body) ?? unreachable('A body was reached again before its own term.');
    }
    this.#entering.add(forwarded);
    const slot = this.slotOf(body);
    this.#entering.delete(forwarded);
    this.#bodies[forwarded] = slot;
    this.#bodies[index] = slot;
    return slot;
  }

  /**
   * The body body `index` is: itself, or, when it is only a placeholder standing for another body,
   * the body that one is, so a body forwarding to another is that body's term, never a term of its
   * own; undefined when the bodies forward around a cycle.
   */
  #forwardedBody(index: number): number | undefined {
    const passed = new Set<number>();
    let current = index;
    for (;;) {
      if (passed.has(current)) {
        return undefined;
      }
      passed.add(current);
      const next = this.#source.placeholderOf(this.#source.bodies[current] ?? errorType);
      if (next === undefined) {
        return current;
      }
      current = next;
    }
  }

  /** The slot `slot` stands for once unions of one member are that member. */
  resolved(slot: Slot): Slot {
    let current = slot;
    for (let step = 0; current.kind === 'term'; step += 1) {
      const next = this.#redirects.get(current.term);
      if (next === undefined) {
        return current;
      }
      if (step > deepestRedirect) {
        return unreachable('A union stands for itself through unions of one member.');
      }
      current = next;
    }
    return current;
  }

  /** The class of `term` once minimized. */
  classOf(term: number): number {
    return this.#ranks[term] ?? unreachable('A term was asked for its class before minimizing.');
  }

  /** The type `term` was built from. */
  typeOf(term: number): Type {
    return this.#termAt(term).type;
  }

  /** Where the parts of `term` lead, resolved, a union's members deduplicated by class or key. */
  partsOf(term: number): readonly Slot[] {
    const { type, parts } = this.#termAt(term);
    const reached = parts.map((part) => this.resolved(part));
    if (type.kind !== 'union') {
      return reached;
    }
    const seen = new Set<string>();
    return reached.filter((part) => {
      const id = this.#partId(part);
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
  }

  /**
   * Flattens unions and refines the terms' classes until no class splits and no union is left with
   * one member's class (the banner); building more terms afterwards is a broken invariant.
   */
  minimize(): void {
    this.#flatten();
    for (;;) {
      this.#refine();
      const collapsed = this.#terms.flatMap((term, index) => {
        if (term.type.kind !== 'union' || this.#redirects.has(index)) {
          return [];
        }
        const [only, ...more] = this.partsOf(index);
        return only !== undefined && more.length === 0 ? [[index, only] as const] : [];
      });
      if (collapsed.length === 0) {
        break;
      }
      for (const [index, only] of collapsed) {
        this.#redirects.set(index, only);
      }
    }
  }

  /**
   * The canonical key of where `slot` leads (the banner): a leaf's own key; a term's, its reachable
   * classes numbered from it in rank order, each spelled with its parts' numbers.
   */
  canonicalKey(slot: Slot): string {
    const root = this.resolved(slot);
    if (root.kind === 'leaf') {
      return root.key;
    }
    const numbers = new Map<number, number>();
    const order: number[] = [];
    const visit = (term: number): void => {
      const rank = this.classOf(term);
      if (numbers.has(rank)) {
        return;
      }
      numbers.set(rank, order.length);
      order.push(term);
      for (const part of this.#canonicalParts(term)) {
        if (part.kind === 'term') {
          visit(part.term);
        }
      }
    };
    visit(root.term);
    const spelled = (part: Slot): string =>
      part.kind === 'leaf' ? part.key : `~${numbers.get(this.classOf(part.term)) ?? '?'}`;
    const bodies = order.map((term) => {
      const type = this.typeOf(term);
      if (type.kind === 'union') {
        return `|<${this.#canonicalParts(term).map(spelled).join(',')}>`;
      }
      return this.#spelled(term, spelled);
    });
    return `~[${bodies.join(';')}]`;
  }

  /** `term`'s parts in canonical order: a union's leaves by key, then its terms by rank. */
  #canonicalParts(term: number): readonly Slot[] {
    const parts = this.partsOf(term);
    if (this.typeOf(term).kind !== 'union') {
      return parts;
    }
    const pairOf = (part: Slot): Signature =>
      part.kind === 'leaf' ? [0, part.key] : [1, this.classOf(part.term)];
    return [...parts].sort((first, second) => compareSignatures(pairOf(first), pairOf(second)));
  }

  /** What tells two parts of a union apart: a leaf's key, a term's class (or index before). */
  #partId(part: Slot): string {
    if (part.kind === 'leaf') {
      return `L${part.key}`;
    }
    const rank = this.#ranks[part.term];
    return rank === undefined ? `T${part.term}` : `C${rank}`;
  }

  #nodeSlot(graph: RecursiveGraph, node: number): Slot {
    const slots = this.#nodes.get(graph) ?? [];
    this.#nodes.set(graph, slots);
    const known = slots[node];
    if (known !== undefined) {
      return known;
    }
    const slot = this.slotOf(graph.nodes[node] ?? errorType);
    // A node reached again while its body is built set its slot already, the body's own term.
    if (slots[node] === undefined) {
      slots[node] = slot;
      if (slot.kind === 'term') {
        this.#imported.push({ graph, node, term: slot.term });
      }
    }
    return slots[node] ?? slot;
  }

  /** Whether `type` holds recursion, a placeholder or a recursive type, so it is a term. */
  #isTerm(type: Type): boolean {
    if (holdsRecursion(type)) {
      return true;
    }
    if (this.#source.bodies.length === 0) {
      // No body, so no placeholder: keying a type never walks a leaf.
      return false;
    }
    const known = this.#holdsPlaceholder.get(type);
    if (known !== undefined) {
      return known;
    }
    const isTerm =
      this.#source.placeholderOf(type) !== undefined ||
      typeChildren(type).some((part) => this.#isTerm(part));
    this.#holdsPlaceholder.set(type, isTerm);
    return isTerm;
  }

  #termAt(term: number): Term {
    return this.#terms[term] ?? unreachable(`No term ${term}.`);
  }

  /** Each union's members flattened and normalized (the banner). */
  #flatten(): void {
    const flattened = this.#terms.map((term, index) =>
      term.type.kind === 'union' ? this.#membersOf(index, new Set()) : undefined,
    );
    const reading: MemberReading<Slot> = {
      typeOf: (part) => (part.kind === 'leaf' ? part.type : this.typeOf(part.term)),
      keyOf: (part) => this.#partId(part),
      memberOf: (type) => this.#leaf(type),
    };
    flattened.forEach((members, index) => {
      if (members === undefined) {
        return;
      }
      const parts = normalizedMembers(members, reading, this.#source.rules);
      this.#termAt(index).parts = parts;
      const [only, ...more] = parts;
      if (only === undefined) {
        this.#redirects.set(index, this.#leaf(neverType));
      } else if (more.length === 0) {
        this.#redirects.set(index, only);
      }
    });
  }

  /** The members union `term` gives a union holding it, `inside` the unions on the way to it. */
  #membersOf(term: number, inside: ReadonlySet<number>): readonly Slot[] {
    const entered = new Set([...inside, term]);
    return this.#termAt(term).parts.flatMap((part): readonly Slot[] => {
      if (part.kind === 'leaf') {
        return part.type.kind === 'union'
          ? part.type.members.map((member) => this.#leaf(member))
          : [part];
      }
      if (this.#termAt(part.term).type.kind !== 'union' || entered.has(part.term)) {
        return entered.has(part.term) ? [] : [part];
      }
      return this.#membersOf(part.term, entered);
    });
  }

  #leaf(type: Type): Slot {
    return { kind: 'leaf', type, key: this.#source.leafKey(type) };
  }

  /** Partition refinement (the banner), over the terms not redirected. */
  #refine(): void {
    const live = this.#terms.flatMap((_, index) => (this.#redirects.has(index) ? [] : [index]));
    const isUnion = (term: number) => this.typeOf(term).kind === 'union';
    this.#ranks = refinedRanks({
      size: this.#terms.length,
      nodes: live.filter((term) => !isUnion(term)),
      unions: live.filter(isUnion),
      spelled: (node, spellPart) => this.#spelled(node, spellPart),
      membersOf: (part) =>
        part.kind === 'term' && isUnion(part.term)
          ? this.#termAt(part.term).parts.map((member) => this.resolved(member))
          : [part],
    });
  }

  /** `term`'s own structure, not a union's, spelled with each of its parts, resolved, by `spellPart`. */
  #spelled(term: number, spellPart: (part: Slot) => string): string {
    const { type, parts } = this.#termAt(term);
    const byChild = new Map(typeChildren(type).map((child, index) => [child, parts[index]]));
    return this.#source.spell(type, (child) => {
      const part = byChild.get(child);
      return part === undefined ? this.#source.leafKey(child) : spellPart(this.resolved(part));
    });
  }
}

/**
 * The canonical key of `type`, a type holding a recursive type (§3.17): its term graph minimized,
 * spelled from it (the banner).
 */
export function canonicalKey(
  type: Type,
  leafKey: (type: Type) => string,
  spell: TermSource['spell'],
): string {
  const graph = new TermGraph({
    bodies: [],
    placeholderOf: () => undefined,
    leafKey,
    spell,
    rules: { absorbs: () => false },
  });
  const root = graph.slotOf(type);
  graph.minimize();
  return graph.canonicalKey(root);
}
