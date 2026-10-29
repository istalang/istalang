/**
 * Which node each comment prints with (formatter.md, Decisions). The tree keeps comments as a flat
 * list of spans with no owner, so the formatter gives each one a node, as Prettier does: it finds
 * the innermost node enclosing the comment, and that node's children just before and after it.
 *
 * A comment printed before a node needs a line to start there when it is own-line, and the printer
 * starts lines only between items: after `,`, `;`, an opening bracket, a header's `:` before its
 * body, or an item before. So an own-line comment:
 * - leads the following child when a line may start before it and nothing but comments stands
 *   between them, and it stands no deeper than that child's line;
 * - otherwise closes the deepest list of items ending just before it that it lines up with (a body,
 *   a declaration's members, a `match`'s cases), printing after its last item, so a comment written
 *   at the end of a body stays in it, or trails the preceding child;
 * - otherwise, right after an opening bracket, is left to the node owning the bracket (dangling),
 *   which prints it inside;
 * - otherwise leads the innermost construct around it that a line may start before: in
 *   `[await\n # c\n f()]`, the `await`.
 * An end-of-line comment prints at the end of its line, wherever its node stands, so it trails the
 * preceding child, or leads the following one, or after an opening bracket is left to its owner. A
 * comment right after a header's `:`, before the body or docstring opening on the next line, is
 * left to that body, which prints it before the line break, so it stays on the header's line instead of
 * trailing a parameter list and breaking it.
 *
 * A child counts as preceding a comment only with no opening bracket between them: `g( # note`
 * belongs to the call's arguments, not to `g`, or whether the arguments break would depend on
 * where the comment went.
 */

import type { Comment } from '../compiler/syntax/tokens.ts';
import { childrenOf, type SyntaxNode, type SyntaxTree } from '../compiler/syntax/tree.ts';
import { encloses } from '../text/span.ts';
import {
  type CommentsOf,
  columnOf,
  describeComment,
  type PlacedComment,
  whitespaceStart,
} from './comments.ts';

type Slot = keyof CommentsOf;

type Placement = readonly [SyntaxNode, Slot];

interface MutableComments {
  readonly leading: PlacedComment[];
  readonly trailing: PlacedComment[];
  readonly dangling: PlacedComment[];
}

/** A comment's surroundings: the nodes enclosing it, root first, and the innermost's children. */
interface Surroundings {
  readonly path: readonly [SyntaxNode, ...SyntaxNode[]];
  readonly enclosing: SyntaxNode;
  readonly preceding: SyntaxNode | undefined;
  readonly following: SyntaxNode | undefined;
}

/** What placing reads: the tree, and where each of its comments ending at an offset starts. */
interface Source {
  readonly tree: SyntaxTree;
  readonly commentStarts: ReadonlyMap<number, number>;
}

/** Each node's comments, for every comment of `tree` outside the spans `isCopied` accepts. */
export function placeComments(
  tree: SyntaxTree,
  isCopied: (comment: Comment) => boolean,
): ReadonlyMap<SyntaxNode, CommentsOf> {
  const context: Source = {
    tree,
    commentStarts: new Map(tree.comments.map(({ span }) => [span.end, span.start])),
  };
  const placement = new Map<SyntaxNode, MutableComments>();
  for (const comment of tree.comments.filter((each) => !isCopied(each))) {
    const placed = describeComment(tree.source, comment);
    const [node, slot] = placeOne(context, surroundingsOf(tree, placed), placed);
    const comments = placement.get(node) ?? { leading: [], trailing: [], dangling: [] };
    if (slot === 'trailing') {
      comments.trailing.push(...takeTrailingAfter(placement, node));
    }
    comments[slot].push(placed);
    placement.set(node, comments);
  }
  return placement;
}

function surroundingsOf(tree: SyntaxTree, comment: PlacedComment): Surroundings {
  const path: [SyntaxNode, ...SyntaxNode[]] = [tree.root];
  for (
    let inner = childrenOf(tree, tree.root).find((child) => encloses(child.span, comment.span));
    inner !== undefined;
    inner = childrenOf(tree, inner).find((child) => encloses(child.span, comment.span))
  ) {
    path.push(inner);
  }
  const enclosing = path.at(-1) ?? tree.root;
  const children = childrenOf(tree, enclosing);
  const before = children.findLast((child) => child.span.end <= comment.span.start);
  const opened =
    before !== undefined && opensBetween(tree.source.text, before.span.end, comment.span.start);
  return {
    path,
    enclosing,
    preceding: opened ? undefined : before,
    following: children.find((child) => child.span.start >= comment.span.end),
  };
}

function placeOne(context: Source, around: Surroundings, comment: PlacedComment): Placement {
  return comment.ownLine
    ? ownLinePlace(context, around, comment)
    : endOfLinePlace(context, around, comment);
}

function endOfLinePlace(
  context: Source,
  { enclosing, preceding, following }: Surroundings,
  comment: PlacedComment,
): Placement {
  const before = tokenBefore(context, comment.span.start);
  const opensBody = following?.kind === 'Block' || following?.kind === 'Docstring';
  if (following !== undefined && opensBody && before === ':') {
    return [following, 'dangling'];
  }
  if (preceding !== undefined) {
    return [preceding, 'trailing'];
  }
  if (following !== undefined && !opener.test(before)) {
    return [following, 'leading'];
  }
  return [enclosing, 'dangling'];
}

function ownLinePlace(context: Source, around: Surroundings, comment: PlacedComment): Placement {
  const { tree } = context;
  const { source } = tree;
  const { path, enclosing, preceding, following } = around;
  const column = columnOf(source, comment.span.start);
  const leads =
    following !== undefined &&
    onlyCommentsBetween(source.text, comment.span.end, following.span.start) &&
    lineMayStartBefore(context, enclosing, comment.span.start, following);
  if (leads && column <= columnOf(source, following.span.start)) {
    return [following, 'leading'];
  }
  if (preceding !== undefined) {
    return [closedItem(tree, preceding, column) ?? preceding, 'trailing'];
  }
  if (opener.test(tokenBefore(context, comment.span.start))) {
    return [enclosing, 'dangling'];
  }
  if (leads) {
    return [following, 'leading'];
  }
  return leadingConstruct(context, path);
}

/** The innermost construct of `path` that a line may start before, which the comment then leads. */
function leadingConstruct(context: Source, path: Surroundings['path']): Placement {
  for (let depth = path.length - 1; depth > 0; depth -= 1) {
    const [parent, node] = [path[depth - 1], path[depth]];
    if (
      parent !== undefined &&
      node !== undefined &&
      lineMayStartBefore(context, parent, node.span.start, node)
    ) {
      return [node, 'leading'];
    }
  }
  // The root encloses only comments: a module of nothing else.
  return [path[0], 'leading'];
}

/** Nodes whose items stand one per line at one column: bodies, members, cases and clauses. */
const itemLists: ReadonlySet<SyntaxNode['kind']> = new Set([
  'Block',
  'StructDeclaration',
  'SharedStructDeclaration',
  'EnumDeclaration',
  'TraitDeclaration',
  'Match',
  'Select',
  'If',
]);

const itemSeparators: ReadonlySet<string> = new Set([',', ';', '(', '[', '{']);

/**
 * Whether the printer may start a line before `following`, a child of `enclosing`, at `offset`:
 * after a separator or an opening bracket, after a `:` opening a body or a list of items, or after
 * an item.
 */
function lineMayStartBefore(
  context: Source,
  enclosing: SyntaxNode,
  offset: number,
  following: SyntaxNode,
): boolean {
  const previous = previousTokenEnd(context, offset);
  if (previous <= enclosing.span.start) {
    return true;
  }
  const token = tokenBefore(context, offset);
  if (token === ':') {
    return (
      following.kind === 'Block' || following.kind === 'Docstring' || itemLists.has(enclosing.kind)
    );
  }
  return (
    itemSeparators.has(token) ||
    childrenOf(context.tree, enclosing).some((child) => child.span.end === previous)
  );
}

/** Where the last token before `offset` ends, past whitespace and comments. */
function previousTokenEnd({ tree, commentStarts }: Source, offset: number): number {
  const { text } = tree.source;
  let end = whitespaceStart(text, offset);
  for (let start = commentStarts.get(end); start !== undefined; start = commentStarts.get(end)) {
    end = whitespaceStart(text, start);
  }
  return end;
}

/** The last character of the token before `offset`, past whitespace and comments. */
function tokenBefore(context: Source, offset: number): string {
  return context.tree.source.text[previousTokenEnd(context, offset) - 1] ?? '';
}

/**
 * The deepest item ending `node`, of a list whose items stand on lines of their own, that stands no
 * deeper than `column`: the list a comment at that column, after `node`, was written to close.
 */
function closedItem(tree: SyntaxTree, node: SyntaxNode, column: number): SyntaxNode | undefined {
  const { source } = tree;
  let found: SyntaxNode | undefined;
  for (
    let [owner, last] = [node, childrenOf(tree, node).at(-1)];
    last !== undefined;
    [owner, last] = [last, childrenOf(tree, last).at(-1)]
  ) {
    const start = columnOf(source, last.span.start);
    const startsLine = source.text.slice(last.span.start - start, last.span.start).trim() === '';
    if (itemLists.has(owner.kind) && startsLine && start <= column) {
      found = last;
    }
  }
  return found;
}

/**
 * The trailing comments of `node`'s ancestors that stand after it, taken from them in order: a
 * comment closing a list after `node` trails `node`, so those before it must too, or they would
 * print after it.
 */
function takeTrailingAfter(
  placement: ReadonlyMap<SyntaxNode, MutableComments>,
  node: SyntaxNode,
): readonly PlacedComment[] {
  const taken: PlacedComment[] = [];
  for (const [ancestor, { trailing }] of placement) {
    if (ancestor !== node && encloses(ancestor.span, node.span)) {
      const after = trailing.filter((comment) => comment.span.start >= node.span.end);
      taken.push(...after);
      trailing.splice(
        0,
        trailing.length,
        ...trailing.filter((comment) => !after.includes(comment)),
      );
    }
  }
  return taken.toSorted((first, second) => first.span.start - second.span.start);
}

const opener = /[([{]/u;
const commentText = /#[^\r\n]*/gu;

/** `text` between `start` and `end` without its comments. */
function codeBetween(text: string, start: number, end: number): string {
  return text.slice(start, end).replaceAll(commentText, '');
}

/** Whether an opening bracket stands between `start` and `end`. */
function opensBetween(text: string, start: number, end: number): boolean {
  return opener.test(codeBetween(text, start, end));
}

function onlyCommentsBetween(text: string, start: number, end: number): boolean {
  return codeBetween(text, start, end).trim() === '';
}
