/**
 * Traversal derived from node fields: children in field order, arrays flattened, primitives and
 * absent optionals skipped; and the queries by position derived from it, over every corpus
 * program, every documented example and random text.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { invalidPrograms, runPrograms } from '../../../test/corpus/programs.ts';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { createSourceText } from '../../text/source-text.ts';
import { parse } from '../parser/parse.ts';
import { scan } from '../scanner/scan.ts';
import type { Call } from './expressions/index.ts';
import type { Identifier } from './node.ts';
import {
  childrenOf,
  nodesAt,
  nodesUnder,
  parentOf,
  type SyntaxNode,
  type SyntaxTree,
} from './tree.ts';

const at = (start: number, end: number) => ({ start, end });
const name = (text: string, start: number): Identifier => ({
  kind: 'Identifier',
  span: at(start, start + text.length),
  text,
});

describe('childrenOf', () => {
  it('returns child nodes in field order, flattening arrays', () => {
    const callee = name('f', 0);
    const first = name('a', 2);
    const second = name('b', 5);
    const call: Call = {
      kind: 'Call',
      span: at(0, 7),
      callee,
      isOptional: false,
      typeArguments: [],
      arguments: [first, second],
    };
    expect(childrenOf(call)).toEqual([callee, first, second]);
  });

  it('skips primitives, spans and absent optionals', () => {
    const member = name('b', 2);
    const target = name('a', 0);
    expect(
      childrenOf({ kind: 'MemberAccess', span: at(0, 3), target, isOptional: false, member }),
    ).toEqual([target, member]);
    expect(
      childrenOf({
        kind: 'Range',
        span: at(0, 2),
        start: undefined,
        isInclusive: false,
        end: undefined,
        step: undefined,
      }),
    ).toEqual([]);
    expect(childrenOf(name('x', 0))).toEqual([]);
  });
});

function parseText(text: string): SyntaxTree {
  const source = createSourceText('example.ista', text);
  return parse(source, scan(source));
}

const trees = [
  ...[...runPrograms, ...invalidPrograms].map(({ text }) => text),
  ...specExamples.map(({ code }) => code),
].map(parseText);

/** Where `nodesAt` breaks its contract over `tree`, at any offset of its text or past its end. */
function positionViolations(tree: SyntaxTree): readonly string[] {
  const holds = (node: SyntaxNode, offset: number) =>
    node.span.start <= offset && offset < node.span.end;
  const violations: string[] = [];
  for (let offset = 0; offset <= tree.source.text.length + 1; offset += 1) {
    const path = nodesAt(tree, offset);
    const innermost = path.at(-1);
    if (innermost !== undefined && !holds(innermost, offset)) {
      violations.push(`${innermost.kind} at ${offset} doesn't hold it`);
    }
    const heldChild = innermost && childrenOf(innermost).find((child) => holds(child, offset));
    if (heldChild !== undefined) {
      violations.push(`${heldChild.kind} at ${offset} holds it, under the innermost`);
    }
    if (!path.slice(1).every((node, index) => parentOf(tree, node) === path[index])) {
      violations.push(`the nodes at ${offset} are no path from the root`);
    }
  }
  const missed = nodesUnder(tree.root).filter(
    (node) => node.span.start < node.span.end && !nodesAt(tree, node.span.start).includes(node),
  );
  return [...violations, ...missed.map((node) => `${node.kind} at ${node.span.start} is missed`)];
}

/** The nodes whose parent `parentOf` doesn't give as the node listing them as children. */
function parentViolations(tree: SyntaxTree): readonly string[] {
  const misplaced = nodesUnder(tree.root).flatMap((node) =>
    childrenOf(node).filter((child) => parentOf(tree, child) !== node),
  );
  return [
    ...(parentOf(tree, tree.root) === undefined ? [] : ['the root has a parent']),
    ...misplaced.map((child) => `${child.kind} at ${child.span.start}`),
  ];
}

const anyText = fc.string({ unit: 'grapheme-ascii', maxLength: 80 }).map(parseText);

describe('nodesAt', () => {
  it('finds, at every offset of every corpus program and example, the nodes holding it', () => {
    expect(trees.flatMap(positionViolations)).toEqual([]);
  });

  it('finds the nodes holding an offset of any text, however broken', () => {
    fc.assert(
      fc.property(anyText, (tree) => {
        expect(positionViolations(tree)).toEqual([]);
      }),
    );
  });
});

describe('parentOf', () => {
  it('inverts childrenOf over every corpus program and example', () => {
    expect(trees.flatMap(parentViolations)).toEqual([]);
  });

  it('inverts childrenOf over any text, however broken', () => {
    fc.assert(
      fc.property(anyText, (tree) => {
        expect(parentViolations(tree)).toEqual([]);
      }),
    );
  });

  it('knows no node of another tree', () => {
    const [first, second] = [parseText('fn a(): 1'), parseText('fn a(): 1')];
    expect(parentOf(first, second.root.items[0] ?? second.root)).toBeUndefined();
  });
});
