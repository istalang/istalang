/**
 * The string literals of a TypeScript file, found by swc's parser, in the groups their text forms.
 *
 * A literal's text is one source, except in a line group: an array literal or an argument list
 * whose items are all string literals, which tests join into one source a line each
 * (`[…].join('\n')`, `lines(…)`, `treeOf(…)`). The shape is recognized, never the helper's name, so
 * a new helper needs no change here. A tagged template means whatever its tag makes of it, so it is no literal here;
 * the code in its substitutions still is.
 *
 * swc's spans are UTF-8 byte positions counted from where its source map placed this parse, which
 * may follow earlier parses. A sentinel statement put before the file marks where the file starts,
 * so positions never depend on what was parsed before; they are turned into UTF-16 offsets once.
 */

import { Buffer } from 'node:buffer';
import {
  type ArrayExpression,
  type CallExpression,
  type ExprOrSpread,
  type NewExpression,
  parseSync,
  type StringLiteral,
  type TaggedTemplateExpression,
  type TemplateLiteral,
} from '@swc/core';
import type { Span } from '../../../../src/foundation/text/span.ts';
import type { Quote } from './escapes.ts';

/** A string or template literal, by the raw text of each part between its substitutions. */
export interface Literal {
  readonly quote: Quote;
  readonly span: Span;
  readonly parts: readonly LiteralPart[];
}

interface LiteralPart {
  /** The part's raw text, without quotes or the `${`/`}` around substitutions. */
  readonly span: Span;
  /** The text swc read it as. */
  readonly cooked: string | undefined;
}

/** A statement whose start marks where the file's own text starts. */
const sentinel = '0;';

interface SwcNode {
  readonly type: string;
  readonly span: { readonly start: number; readonly end: number };
}

/** The literals of `contents` in file order, each line group's together. */
export function literalGroupsOf(contents: string): readonly (readonly Literal[])[] {
  const module = parseSync(`${sentinel}${contents}`, { syntax: 'typescript', target: 'es2024' });
  const fileStart = (module.body[0]?.span.start ?? 0) + sentinel.length;
  const utf16At = utf16OffsetsOf(contents);
  const spanOf = (span: SwcNode['span']): Span => ({
    start: utf16At[span.start - fileStart] ?? 0,
    end: utf16At[span.end - fileStart] ?? 0,
  });
  const found = new LiteralFinder();
  found.visit(module);
  return found.groups
    .map((group) => group.map((literal) => literalOf(literal, spanOf, contents)))
    .toSorted((first, second) => (first[0]?.span.start ?? 0) - (second[0]?.span.start ?? 0));
}

type LiteralNode = StringLiteral | TemplateLiteral;

/** Walks swc's tree, collecting literals in groups. */
class LiteralFinder {
  readonly groups: (readonly LiteralNode[])[] = [];
  /** Literals in a group already, and tagged templates', which are no literals of their own. */
  readonly #taken = new Set<object>();

  /** Visits every node in `value`, a node or any object or array holding nodes. */
  visit(value: object): void {
    if (isNode(value)) {
      this.#take(value);
    }
    for (const child of Object.values(value)) {
      if (typeof child === 'object' && child !== null) {
        this.visit(child);
      }
    }
  }

  #take(node: SwcNode): void {
    if (node.type === 'TaggedTemplateExpression') {
      this.#taken.add((node as TaggedTemplateExpression).template);
      return;
    }
    const group = lineGroupOf(node);
    if (group !== undefined) {
      this.groups.push(group);
      for (const literal of group) {
        this.#taken.add(literal);
      }
    } else if (isLiteral(node) && !this.#taken.has(node)) {
      this.groups.push([node]);
    }
  }
}

function isNode(value: unknown): value is SwcNode {
  return typeof value === 'object' && value !== null && typeof (value as SwcNode).type === 'string';
}

function isLiteral(node: { readonly type: string }): node is LiteralNode {
  return node.type === 'StringLiteral' || node.type === 'TemplateLiteral';
}

/** The items of an array literal or argument list, when every one is a string literal. */
function lineGroupOf(node: SwcNode): readonly LiteralNode[] | undefined {
  const items = itemsOf(node);
  if (items === undefined || items.length === 0) {
    return undefined;
  }
  const literals = items.flatMap((item) =>
    item !== undefined && (item.spread ?? undefined) === undefined && isLiteral(item.expression)
      ? [item.expression]
      : [],
  );
  return literals.length === items.length ? literals : undefined;
}

function itemsOf(node: SwcNode): readonly (ExprOrSpread | undefined)[] | undefined {
  switch (node.type) {
    case 'ArrayExpression':
      return (node as ArrayExpression).elements;
    case 'CallExpression':
      return (node as CallExpression).arguments;
    case 'NewExpression':
      return (node as NewExpression).arguments;
    default:
      return undefined;
  }
}

function literalOf(
  node: LiteralNode,
  spanOf: (span: SwcNode['span']) => Span,
  contents: string,
): Literal {
  const span = spanOf(node.span);
  if (node.type === 'StringLiteral') {
    const quote = contents[span.start] === '"' ? '"' : "'";
    return {
      quote,
      span,
      parts: [{ span: { start: span.start + 1, end: span.end - 1 }, cooked: node.value }],
    };
  }
  return {
    quote: '`',
    span,
    parts: node.quasis.map((quasi) => ({ span: spanOf(quasi.span), cooked: quasi.cooked })),
  };
}

/** The UTF-16 offset of each UTF-8 byte offset of `text` starting a character, and of its end. */
function utf16OffsetsOf(text: string): readonly number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const char of text) {
    for (let byte = Buffer.byteLength(char); byte > 0; byte -= 1) {
      offsets.push(offset);
    }
    offset += char.length;
  }
  offsets.push(offset);
  return offsets;
}
