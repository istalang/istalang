/**
 * Which grammar position a `grammar` place is: what the placeholder's parse made of a name there,
 * and the tokens before it where the parser can't tell.
 *
 * - Off a line's start, the tokens before the cursor decide first: after a modifier, only its
 *   follower may come (`async fn`, `hold let`); after a `for`'s or a comprehension's target, its
 *   `in`; after an operand, what goes on after one, once a space parts them, and nothing right
 *   against it (`plus(1)‸`), where a word would be glued to the operand. The parser cut off
 *   whatever it could not finish there (a header before its `:`, a guard, a template's `${…}`, a
 *   call's argument), so its tree can't. After an operand shaped as a deferred call's taker, which
 *   the placeholder's parse gives the name as the call it defers (§3.14), a name starting that call
 *   may come too.
 * - A name the parser can't place (an `Invalid` node) stands in a `match` or `select` body, which
 *   holds only cases, or in a line of a module or a block.
 * - A name starting a block's item, first on its line or after `;`, `:` or `{`, starts a
 *   statement, whatever is written after it on the line.
 * - A name in a header or an operand is an operand, unless what holds it asks for a narrower
 *   kind of name: a label, or a place a call's argument passes by reference.
 */

import { moduleItemWords } from '../../../../../compiler/syntax/items.ts';
import type { LabelledScope } from '../../../../../compiler/syntax/statements/index.ts';
import {
  followers,
  infixWords,
  type Modifier,
  type Word,
} from '../../../../../compiler/syntax/tokens/grammar-words.ts';
import { isKeyword, type Token } from '../../../../../compiler/syntax/tokens/index.ts';
import {
  childrenOf,
  extentIn,
  nodesAt,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../../../compiler/syntax/tree/index.ts';
import type { Identifier, Invalid } from '../../../../../compiler/syntax/tree/node.ts';
import { codeTokensOf } from '../../../reading/tokens.ts';
import { adjoins, adjoinsBefore, type Cursor, touchingBefore } from '../../cursor.ts';
import type { ParsedPlace } from '../../placeholder.ts';
import { holderIn } from './chain.ts';
import { type Surroundings, surroundingsOf } from './surroundings.ts';

export type GrammarPosition =
  /** Only these words may be written. */
  | { readonly kind: 'words'; readonly words: readonly Word[] }
  /**
   * After a deferred call's taker (§3.14): a name starting the call it is given, or one of the
   * words going on after the taker as an operand.
   */
  | { readonly kind: 'deferredCall'; readonly words: readonly Word[] }
  /** A block's item starts; `continuesIf` when it follows an `if` chain with no `else` yet. */
  | {
      readonly kind: 'statement';
      readonly surroundings: Surroundings;
      readonly continuesIf: boolean;
    }
  | { readonly kind: 'operand'; readonly surroundings: Surroundings }
  /** The place a `&` passes (§3.7). */
  | { readonly kind: 'referenced' }
  | { readonly kind: 'labels'; readonly labels: readonly Identifier[] };

type GrammarPlace = Extract<ParsedPlace, { readonly kind: 'grammar' }>;
type Parse = GrammarPlace['parsed'];

export function grammarPositionAt(cursor: Cursor, { parsed }: GrammarPlace): GrammarPosition {
  const { tree, chain } = parsed;
  const node = chain.at(-1);
  const parent = chain.at(-2);
  if (node === undefined || parent === undefined) {
    return words(moduleItemWords);
  }
  const startsLine = startsItem(cursor);
  const after =
    startsLine || adjoinsBefore(cursor) === undefined
      ? undefined
      : positionAfter(cursor, parsed, parent, node);
  if (after !== undefined) {
    return after;
  }
  const surroundings = surroundingsOf(tree, chain);
  if (node.kind === 'Invalid') {
    return unplacedIn(cursor, parsed, node, surroundings);
  }
  const item = itemStartedBy(parsed, node);
  if (item !== undefined && startsLine) {
    return statement(parsed, item.block, item.node, surroundings);
  }
  return heldIn(parsed, parent, node, surroundings);
}

/**
 * What alone may follow the tokens before the cursor, where those decide it: the words after a
 * modifier or a loop's target; after an operand, the words going on after it, and where the
 * operand is a deferred call's taker, a name starting its call (§3.14).
 */
function positionAfter(
  cursor: Cursor,
  parsed: Parse,
  parent: SyntaxNode,
  node: SyntaxNode,
): GrammarPosition | undefined {
  const modifier = modifierBefore(cursor, parsed);
  if (modifier !== undefined) {
    return words(followers[modifier]);
  }
  if (iteratesOver(parent, node) && !writesIn(parsed, parent)) {
    return words(['in']);
  }
  if (!endsOperand(cursor.before)) {
    return undefined;
  }
  if (touchingBefore(cursor) !== undefined) {
    return words([]);
  }
  const going = goingOn(cursor);
  return startsDeferredCall(parsed, node) ? { kind: 'deferredCall', words: going } : words(going);
}

/**
 * Whether the name `name` starts the call a deferred call gives its taker (§3.14), as the
 * placeholder's parse reads it: some node holding it is a deferred call whose call starts there.
 */
function startsDeferredCall({ tree, chain }: Parse, name: SyntaxNode): boolean {
  const { start } = extentIn(tree, name);
  return chain.some(
    (node) => node.kind === 'DeferredCall' && extentIn(tree, node.call).start === start,
  );
}

/** Whether `node` is the iterable of `parent`, a `for` loop or a comprehension. */
function iteratesOver(parent: SyntaxNode, node: SyntaxNode): boolean {
  return (parent.kind === 'For' || parent.kind === 'Comprehension') && parent.iterable === node;
}

/** What a name held as `node` by `parent` may be, where it starts no item. */
function heldIn(
  parsed: Parse,
  parent: SyntaxNode,
  node: SyntaxNode,
  surroundings: Surroundings,
): GrammarPosition {
  const operand: GrammarPosition = { kind: 'operand', surroundings };
  switch (parent.kind) {
    case 'Break':
    case 'Continue':
      return labels(surroundings.scopes.filter(({ kind }) => kind !== 'LabelledBlock'));
    case 'Call':
      return holds(parent, node) ? labels(surroundings.scopes) : operand;
    case 'Reference':
      return passesArgument(parsed, parent) ? { kind: 'referenced' } : operand;
    default:
      return operand;
  }
}

/** Whether `reference` is a call's argument, the only place a `&` may stand (§3.7). */
function passesArgument({ chain }: Parse, reference: SyntaxNode): boolean {
  const holder = holderIn(chain, reference);
  return holder?.kind === 'Call' || holder?.kind === 'NamedArgument';
}

/** `hold(‸`: the label of a scope to hold until (§3.4); the parser reads it as a call. */
function holds(call: Extract<SyntaxNode, { readonly kind: 'Call' }>, node: SyntaxNode): boolean {
  const { callee } = call;
  return callee.kind === 'Identifier' && callee.text === 'hold' && callee !== node;
}

function words(admitted: readonly Word[]): GrammarPosition {
  return { kind: 'words', words: admitted };
}

function labels(scopes: readonly LabelledScope[]): GrammarPosition {
  return {
    kind: 'labels',
    labels: scopes.flatMap(({ label }) => (label === undefined ? [] : [label])),
  };
}

function statement(
  { tree }: Parse,
  block: SyntaxNode,
  item: SyntaxNode,
  surroundings: Surroundings,
): GrammarPosition {
  return { kind: 'statement', surroundings, continuesIf: continuesIf(tree, block, item) };
}

/** A name the parser could make nothing of, as `unplaced`, an item of what holds it. */
function unplacedIn(
  cursor: Cursor,
  parsed: Parse,
  unplaced: Invalid,
  surroundings: Surroundings,
): GrammarPosition {
  const parent = holderIn(parsed.chain, unplaced);
  switch (parent?.kind) {
    case 'Match':
      return words(['case']);
    case 'Select':
      return words(parent.awaits || parent.elseClause !== undefined ? ['case'] : ['case', 'else']);
    case 'Module':
      return words(startsItem(cursor) ? moduleItemWords : []);
    default:
      if (parent !== undefined && startsItem(cursor)) {
        return statement(parsed, parent, unplaced, surroundings);
      }
      return cursor.before !== undefined && isKeyword(cursor.before.kind)
        ? { kind: 'operand', surroundings }
        : words([]);
  }
}

/**
 * The block's item the placeholder's name starts, written alone or first of an expression
 * (`to‸tal + count`): the outermost node whose own text starts where the name does, past its
 * annotations, if a block holds it.
 */
function itemStartedBy(
  { tree, chain }: Parse,
  name: SyntaxNode,
): { readonly block: SyntaxNode; readonly node: SyntaxNode } | undefined {
  const { start } = extentIn(tree, name);
  let node = name;
  for (
    let holder = holderIn(chain, node);
    holder !== undefined && holder.kind !== 'Block' && ownStartOf(tree, holder) === start;
    holder = holderIn(chain, node)
  ) {
    node = holder;
  }
  const block = holderIn(chain, node);
  return block?.kind === 'Block' ? { block, node } : undefined;
}

/** Whether what the cursor writes starts an item: first on its line, or after `;`, `:` or `{`. */
function startsItem({ tree, before, name, offset }: Cursor): boolean {
  if (before === undefined || itemOpeners.has(before.kind)) {
    return true;
  }
  return tree.source.text.slice(before.span.end, name?.span.start ?? offset).includes('\n');
}

const itemOpeners: ReadonlySet<string> = new Set([';', ':', '{']);

/**
 * The modifier right before the cursor, if the word there stands as one in the placeholder's
 * parse, which reads it alike whatever name is begun after it (`sendable fn‸` as `sendable ‸`).
 */
function modifierBefore({ before }: Cursor, { tree }: Parse): Modifier | undefined {
  if (before === undefined) {
    return undefined;
  }
  const word = heldLabelOf(tree, before) ?? before;
  const text = tree.source.text.slice(word.span.start, word.span.end);
  return isModifier(text) && standsAsModifier[text](tree, word) ? text : undefined;
}

function isModifier(text: string): text is Modifier {
  return Object.hasOwn(followers, text);
}

/**
 * Where each modifier is one: `async` anywhere; `shared` starting a module's item; `hold` starting
 * a block's item; `sendable` read as a type; `not` after an operand, only spaces and tabs between,
 * starting `not in`: a line break or a template's `${` between starts an operand instead.
 */
const standsAsModifier: Readonly<Record<Modifier, (tree: SyntaxTree, word: Token) => boolean>> = {
  async: () => true,
  shared: (tree, word) => startsItemOf('Module', tree, word),
  hold: (tree, word) => startsItemOf('Block', tree, word),
  sendable: (tree, word) => nodesAt(tree, word.span.start).some(({ kind }) => kind === 'NamedType'),
  not: (tree, word) => {
    const operand = tokenBefore(tree, word);
    return endsOperand(operand) && adjoins(tree, operand, word.span.start);
  },
};

/**
 * Whether `word` starts an item of a `holder` node, as the parser read the text holding it: the
 * item's own first token, past the annotations it holds, an Invalid one's included.
 */
function startsItemOf(holder: 'Module' | 'Block', tree: SyntaxTree, word: Token): boolean {
  const chain = nodesAt(tree, word.span.start);
  return chain.some((node, index) => {
    const item = chain[index + 1];
    return node.kind === holder && item !== undefined && ownStartOf(tree, item) === word.span.start;
  });
}

/** Where `item`'s own text starts: its first token not inside one of its annotations. */
function ownStartOf(tree: SyntaxTree, item: SyntaxNode): number | undefined {
  const annotations = ('annotations' in item ? item.annotations : undefined) ?? [];
  const annotated = annotations.map((annotation) => extentIn(tree, annotation));
  const { start } = extentIn(tree, item);
  return codeTokensOf(tree).find(
    ({ span }) =>
      span.start >= start &&
      !annotated.some((each) => each.start <= span.start && span.start < each.end),
  )?.span.start;
}

/** The `hold` of `hold(label)` when `closing` is its `)`, which `let` or `const` follows. */
function heldLabelOf(tree: SyntaxTree, closing: Token): Token | undefined {
  if (closing.kind !== ')') {
    return undefined;
  }
  const call = nodesAt(tree, closing.span.start).find(
    (node) => node.kind === 'Call' && extentIn(tree, node).end === closing.span.end,
  );
  if (call?.kind !== 'Call' || call.callee.kind !== 'Identifier' || call.callee.text !== 'hold') {
    return undefined;
  }
  const { start } = extentIn(tree, call.callee);
  return codeTokensOf(tree).find(({ span }) => span.start === start);
}

function tokenBefore(tree: SyntaxTree, token: Token): Token | undefined {
  return codeTokensOf(tree).findLast(({ span }) => span.end <= token.span.start);
}

/** Whether `token` is an operand's last: a name, a literal, a closing bracket, `?` or `!`. */
function endsOperand(token: Token | undefined): token is Token {
  return token !== undefined && operandEnds.has(token.kind);
}

const operandEnds: ReadonlySet<string> = new Set([
  'identifier',
  'integer',
  'float',
  'duration',
  'string',
  'template',
  'true',
  'false',
  'none',
  ')',
  ']',
  '}',
  '?',
  '!',
]);

/**
 * What may go on after the operand right before the cursor: an infix word, `by` after a range
 * with no step, `as` after a `select` case's future (§4, §3.8, §8).
 */
function goingOn({ tree, before }: Cursor): readonly Word[] {
  if (before === undefined) {
    return infixWords;
  }
  const holding = nodesAt(tree, before.span.start);
  const ending = holding.filter((node) => extentIn(tree, node).end === before.span.end);
  const stepless = ending.some((node) => node.kind === 'Range' && node.step === undefined);
  const future = holding.some((node) => node.kind === 'SelectCase' && ending.includes(node.future));
  return [...infixWords, ...(stepless ? rangeWords : []), ...(future ? selectCaseWords : [])];
}

const rangeWords: readonly Word[] = ['by'];
const selectCaseWords: readonly Word[] = ['as'];

/** Whether `item` of `block` follows an item ending in an `if` chain that has no `else` yet. */
function continuesIf(tree: SyntaxTree, block: SyntaxNode, item: SyntaxNode): boolean {
  if (block.kind !== 'Block') {
    return false;
  }
  const previous = block.statements[(block.statements as readonly SyntaxNode[]).indexOf(item) - 1];
  return previous !== undefined && endsInOpenIf(tree, previous);
}

/**
 * Whether `node` ends in an `if` chain with no `else`, as a statement, a declared value or a
 * returned one does (§4): its last node, down to the first `if`, never into a block, whose `if`
 * takes its `else` deeper.
 */
function endsInOpenIf(tree: SyntaxTree, node: SyntaxNode): boolean {
  for (
    let last: SyntaxNode | undefined = node;
    last !== undefined && last.kind !== 'Block';
    last = childrenOf(tree, last).at(-1)
  ) {
    if (last.kind === 'If') {
      return last.elseClause === undefined;
    }
  }
  return false;
}

/** Whether `loop`'s `in` is written before the cursor. */
function writesIn({ tree, offset }: Parse, loop: SyntaxNode): boolean {
  const { start } = extentIn(tree, loop);
  return codeTokensOf(tree).some(
    ({ kind, span }) => kind === 'in' && span.start >= start && span.end <= offset,
  );
}
