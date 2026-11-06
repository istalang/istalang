/**
 * A module parsed again after an edit, keeping from the tree parsed before it every segment of its
 * text the edit left alike (docs/work/m6-m7/incremental-checking.md §2).
 *
 * The module is scanned and parsed whole, since layout makes the bounds of an edited region subtle,
 * and then each segment of the new tree whose text equals one of the old tree's is given the old
 * one's nodes. Spans are anchored to segments, so an old segment's nodes stand at their new place
 * once the tree gives that segment its new start, and everything keyed by them (bindings, checked
 * results) outlives the edit.
 *
 * - A header is reused when its text is alike from the start of the line it begins on, so the
 *   indentation layout reads is alike too. The run of a list's items standing in one header (an
 *   item and what recovery made of the rest of its line, or annotations waiting for their item) is
 *   reused whole. A trait heading its members' segments is reused only with all of them, since its
 *   node holds them.
 * - A body is reused when its text is alike and its function's header was, which decides the column
 *   it is laid out from. A reused header whose body changed keeps its node with the new body: a
 *   function's identity is its header (syntax/tree.ts).
 * - Old runs are matched to new ones by text, in order, so an item moved or repeated is found too.
 *   The module's own segment (its root and docstring), the comments and the diagnostics are always
 *   the new parse's.
 */

import { addToGroup } from '../../structures/groups.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { lineStartAt } from '../../text/line-map.ts';
import type {
  FunctionDeclaration,
  Module,
  TraitDeclaration,
} from '../syntax/declarations/index.ts';
import { type Segment, spanIn } from '../syntax/positions.ts';
import type { Block } from '../syntax/statements.ts';
import type { SyntaxTree } from '../syntax/tree.ts';
import { bodiesHeldBy } from './held-bodies.ts';

type Item = Module['items'][number];
type Member = TraitDeclaration['members'][number];

/** A node of a list whose items may head segments: a module's item, or a trait's member. */
type Listed = Item | Member;

/** Consecutive nodes of one list standing in one segment. */
interface Run<Node extends Listed> {
  readonly segment: Segment;
  readonly nodes: readonly Node[];
  /** The segment's text, for a header; undefined for nodes no segment of their own holds. */
  readonly text: SegmentText | undefined;
}

/** A segment's text from the start of the line it begins on, and its column on that line. */
interface SegmentText {
  readonly text: string;
  readonly column: number;
}

/**
 * `fresh`, the tree of an edited text, holding `previous`'s nodes wherever their text is alike.
 * Its bodies are those the parser recorded, some maybe of nodes recovery let go of.
 */
export function reusingSegments(fresh: SyntaxTree, previous: SyntaxTree): SyntaxTree {
  const reuse = new SegmentReuse(fresh, previous);
  const root: Module = { ...fresh.root, items: reuse.items() };
  return { ...fresh, root, bodies: reuse.bodies(), bases: reuse.bases };
}

class SegmentReuse {
  /** Where each segment of the tree being made starts: old segments reused at their new place. */
  readonly bases: Map<Segment, number>;
  readonly #fresh: SyntaxTree;
  readonly #previous: SyntaxTree;
  /** The old tree's runs of items not reused yet, by their text. */
  readonly #unused = new Map<string, Run<Item>[]>();
  /** The new bodies of reused functions whose body changed. */
  readonly #newBodies = new Map<FunctionDeclaration, Block>();
  /** The new parse's nodes the tree keeps: its items no old run matched. */
  readonly #kept: Item[] = [];

  constructor(fresh: SyntaxTree, previous: SyntaxTree) {
    this.#fresh = fresh;
    this.#previous = previous;
    this.bases = new Map(fresh.bases);
    for (const run of runsOf(previous, previous.root.items)) {
      if (run.text !== undefined) {
        addToGroup(this.#unused, run.text.text, run);
      }
    }
  }

  /** The module's items: the new parse's, but for every run an old one matched. */
  items(): readonly Item[] {
    return runsOf(this.#fresh, this.#fresh.root.items).flatMap((run) => {
      const taken = this.#taken(run);
      if (taken === undefined) {
        this.#kept.push(...run.nodes);
      }
      return taken?.nodes ?? run.nodes;
    });
  }

  /**
   * The bodies of the functions the tree holds, once `items` has run. An old function holds its
   * body when its segment was reused, unless its body changed; the new nodes kept are walked for
   * theirs, so an edit costs what it re-parsed, not the module.
   */
  bodies(): ReadonlyMap<FunctionDeclaration, Block> {
    const bodies = bodiesHeldBy([...this.#kept, ...this.#newBodies.values()], this.#fresh.bodies);
    for (const [declaration, body] of this.#previous.bodies) {
      if (this.bases.has(declaration.span.segment)) {
        bodies.set(declaration, this.#newBodies.get(declaration) ?? body);
      }
    }
    return bodies;
  }

  /** The unused old run alike to `run`, now reused, if there is one. */
  #taken(run: Run<Item>): Run<Item> | undefined {
    const candidates = run.text === undefined ? [] : (this.#unused.get(run.text.text) ?? []);
    const index = candidates.findIndex((candidate) => this.#sameRun(candidate, run));
    const [old] = index === -1 ? [] : candidates.splice(index, 1);
    if (old !== undefined) {
      this.#reuse(old, run);
    }
    return old;
  }

  #sameRun<Node extends Listed>(old: Run<Node>, run: Run<Node>): boolean {
    return (
      old.text !== undefined &&
      run.text !== undefined &&
      old.text.text === run.text.text &&
      old.text.column === run.text.column &&
      old.nodes.length === run.nodes.length &&
      old.nodes.every((node, index) => this.#sameNode(node, run.nodes[index]))
    );
  }

  #sameNode(old: Listed, node: Listed | undefined): boolean {
    if (node === undefined || old.kind !== node.kind) {
      return false;
    }
    if (old.kind === 'TraitDeclaration' && node.kind === 'TraitDeclaration') {
      const oldMembers = memberRunsOf(this.#previous, old);
      const members = memberRunsOf(this.#fresh, node);
      return (
        oldMembers.length === members.length &&
        oldMembers.every((each, index) => {
          const member = members[index];
          return member !== undefined && this.#sameRun(each, member);
        })
      );
    }
    if (old.kind === 'FunctionDeclaration' && node.kind === 'FunctionDeclaration') {
      return (
        (this.#previous.bodies.get(old) === undefined) ===
        (this.#fresh.bodies.get(node) === undefined)
      );
    }
    return true;
  }

  /** Gives `run`'s segments to `old`'s nodes, which `#sameRun` found alike. */
  #reuse<Node extends Listed>(old: Run<Node>, run: Run<Node>): void {
    this.#move(old.segment, run.segment);
    for (const [index, node] of old.nodes.entries()) {
      const counterpart = run.nodes[index];
      if (node.kind === 'TraitDeclaration' && counterpart?.kind === 'TraitDeclaration') {
        const members = memberRunsOf(this.#fresh, counterpart);
        for (const [at, each] of memberRunsOf(this.#previous, node).entries()) {
          const member = members[at];
          if (member !== undefined) {
            this.#reuse(each, member);
          }
        }
      }
      if (node.kind === 'FunctionDeclaration' && counterpart?.kind === 'FunctionDeclaration') {
        this.#reuseBody(node, counterpart);
      }
    }
  }

  /** Keeps `old`'s body when its text is alike to `fresh`'s, else gives `old` the new one. */
  #reuseBody(old: FunctionDeclaration, fresh: FunctionDeclaration): void {
    const oldBody = this.#previous.bodies.get(old);
    const body = this.#fresh.bodies.get(fresh);
    if (oldBody === undefined || body === undefined || body.span.segment === fresh.span.segment) {
      return;
    }
    const before = segmentText(this.#previous, oldBody.span.segment, oldBody.span.to);
    const after = segmentText(this.#fresh, body.span.segment, body.span.to);
    if (before.text === after.text && before.column === after.column) {
      this.#move(oldBody.span.segment, body.span.segment);
    } else {
      this.#newBodies.set(old, body);
    }
  }

  /** Puts `old` where the new parse put `segment`, which the tree no longer holds. */
  #move(old: Segment, segment: Segment): void {
    this.bases.set(old, this.bases.get(segment) ?? unreachable('A new segment has no start.'));
    this.bases.delete(segment);
  }
}

/** `nodes`, a list of `tree`'s, as runs of consecutive nodes standing in one segment. */
function runsOf<Node extends Listed>(
  tree: SyntaxTree,
  nodes: readonly Node[],
): readonly Run<Node>[] {
  const runs: Node[][] = [];
  for (const node of nodes) {
    const last = runs.at(-1);
    if (last?.[0]?.span.segment === node.span.segment) {
      last.push(node);
    } else {
      runs.push([node]);
    }
  }
  return runs.map((run) => {
    const [{ span }] = run as [Node, ...Node[]];
    const to = Math.max(...run.map((node) => node.span.to));
    const text = span.segment.kind === 'header' ? segmentText(tree, span.segment, to) : undefined;
    return { segment: span.segment, nodes: run, text };
  });
}

/** The runs of `trait`'s members heading segments of their own; none when it heads none. */
function memberRunsOf(tree: SyntaxTree, trait: TraitDeclaration): readonly Run<Member>[] {
  const heading = trait.members.filter((member) => member.span.segment !== trait.span.segment);
  return runsOf(tree, heading);
}

/** The text of `segment` of `tree` up to `to`, from the start of the line it begins on. */
function segmentText(tree: SyntaxTree, segment: Segment, to: number): SegmentText {
  const { start, end } = spanIn(tree, { segment, from: 0, to });
  const lineStart = lineStartAt(tree.source.text, start);
  return { text: tree.source.text.slice(lineStart, end), column: start - lineStart };
}
