/**
 * Traversal derived from node fields: children in field order, arrays flattened, primitives and
 * absent optionals skipped, and a function's body, which the tree holds, after them; and the
 * queries by position derived from it, over every corpus program, every documented example and
 * random text.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { invalidPrograms, runPrograms } from '../../../test/corpus/programs.ts';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { createSourceText } from '../../text/source-text.ts';
import { textOf } from '../../text/span.ts';
import { parse } from '../parser/parse.ts';
import { scan } from '../scanner/scan.ts';
import type { Call } from './expressions/index.ts';
import type { Identifier } from './node.ts';
import { spanIn } from './positions.ts';
import { handMadeSpan as at, strayBodies } from './tree.test-kit.ts';
import {
  bodyOf,
  childrenOf,
  extentIn,
  fieldChildrenOf,
  nodesAt,
  nodesUnder,
  parentOf,
  type SyntaxNode,
  type SyntaxTree,
} from './tree.ts';

const name = (text: string, start: number): Identifier => ({
  kind: 'Identifier',
  span: at(start, start + text.length),
  text,
});

describe('fieldChildrenOf', () => {
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
    expect(fieldChildrenOf(call)).toEqual([callee, first, second]);
  });

  it('skips primitives, spans and absent optionals', () => {
    const member = name('b', 2);
    const target = name('a', 0);
    expect(
      fieldChildrenOf({ kind: 'MemberAccess', span: at(0, 3), target, isOptional: false, member }),
    ).toEqual([target, member]);
    expect(
      fieldChildrenOf({
        kind: 'Range',
        span: at(0, 2),
        start: undefined,
        isInclusive: false,
        end: undefined,
        step: undefined,
      }),
    ).toEqual([]);
    expect(fieldChildrenOf(name('x', 0))).toEqual([]);
  });
});

function parseText(text: string): SyntaxTree {
  const source = createSourceText('example.ista', text);
  return parse(source, scan(source));
}

describe('childrenOf', () => {
  it("gives a function's body, which no field holds, after its other children", () => {
    const tree = parseText('fn f(a: int) -> int:\n  a\n');
    const [f] = tree.root.items;
    if (f?.kind !== 'FunctionDeclaration') {
      throw new Error('Expected a function.');
    }
    const body = bodyOf(tree, f);
    expect(body?.kind).toBe('Block');
    expect(fieldChildrenOf(f)).not.toContain(body);
    expect(childrenOf(tree, f).at(-1)).toBe(body);
    expect(childrenOf(tree, f).slice(0, -1)).toEqual(fieldChildrenOf(f));
  });

  it('gives a function written without a body none', () => {
    const tree = parseText('extern fn host(x: int) -> int\n');
    const [host] = tree.root.items;
    expect(host?.kind === 'FunctionDeclaration' && bodyOf(tree, host)).toBe(undefined);
  });
});

const trees = [
  ...[...runPrograms, ...invalidPrograms].map(({ text }) => text),
  ...specExamples.map(({ code }) => code),
].map(parseText);

/** Where `nodesAt` breaks its contract over `tree`, at any offset of its text or past its end. */
function positionViolations(tree: SyntaxTree): readonly string[] {
  const holds = (node: SyntaxNode, offset: number) => {
    const { start, end } = extentIn(tree, node);
    return start <= offset && offset < end;
  };
  const violations: string[] = [];
  for (let offset = 0; offset <= tree.source.text.length + 1; offset += 1) {
    const path = nodesAt(tree, offset);
    const innermost = path.at(-1);
    if (innermost !== undefined && !holds(innermost, offset)) {
      violations.push(`${innermost.kind} at ${offset} doesn't hold it`);
    }
    const heldChild =
      innermost && childrenOf(tree, innermost).find((child) => holds(child, offset));
    if (heldChild !== undefined) {
      violations.push(`${heldChild.kind} at ${offset} holds it, under the innermost`);
    }
    if (!path.slice(1).every((node, index) => parentOf(tree, node) === path[index])) {
      violations.push(`the nodes at ${offset} are no path from the root`);
    }
  }
  const missed = nodesUnder(tree, tree.root).filter((node) => {
    const { start, end } = extentIn(tree, node);
    return start < end && !nodesAt(tree, start).includes(node);
  });
  return [
    ...violations,
    ...missed.map((node) => `${node.kind} at ${extentIn(tree, node).start} is missed`),
  ];
}

/** The nodes whose parent `parentOf` doesn't give as the node listing them as children. */
function parentViolations(tree: SyntaxTree): readonly string[] {
  const misplaced = nodesUnder(tree, tree.root).flatMap((node) =>
    childrenOf(tree, node).filter((child) => parentOf(tree, child) !== node),
  );
  return [
    ...(parentOf(tree, tree.root) === undefined ? [] : ['the root has a parent']),
    ...misplaced.map((child) => `${child.kind} at ${extentIn(tree, child).start}`),
  ];
}

const anyText = fc.string({ unit: 'grapheme-ascii', maxLength: 80 }).map(parseText);

describe('segments', () => {
  const tree = parseText(
    '@A\nfn f(x: int) -> int:\n  """Doc."""\n  fn g(): x\n  g()\ntrait T:\n  fn m()\n  n: int\ntrait B { fn m() }\n',
  );
  const [f, t, b] = tree.root.items;
  if (f?.kind !== 'FunctionDeclaration' || t?.kind !== 'TraitDeclaration' || b === undefined) {
    throw new Error('Expected a function and two traits.');
  }
  const body = bodyOf(tree, f);
  const [local] = body?.statements ?? [];
  const textAt = (node: SyntaxNode) => textOf(tree.source, spanIn(tree, node.span));
  const extentText = (node: SyntaxNode) => textOf(tree.source, extentIn(tree, node));

  it('give each top-level item a header of its own, from its annotations on', () => {
    expect(tree.root.span.segment.kind).toBe('module');
    expect(new Set([f, t, b].map((item) => item.span.segment)).size).toBe(3);
    expect([f, t, b].every((item) => item.span.segment.kind === 'header')).toBe(true);
    expect(spanIn(tree, f.span).start).toBe(0);
  });

  it("end a function's span with its header, docstring included, where its body's begins", () => {
    expect(textAt(f)).toBe('@A\nfn f(x: int) -> int:\n  """Doc."""');
    expect(body?.span.segment.kind).toBe('body');
    expect(body && tree.bases.get(body.span.segment)).toBe(spanIn(tree, f.span).end);
    expect(extentText(f)).toBe(`${textAt(f)}\n  fn g(): x\n  g()`);
  });

  it("keep a local function's header and body in the body around them", () => {
    expect(local?.kind).toBe('FunctionDeclaration');
    if (local?.kind !== 'FunctionDeclaration') {
      return;
    }
    expect(local.span.segment).toBe(body?.span.segment);
    expect(bodyOf(tree, local)?.span.segment).toBe(body?.span.segment);
    expect(textAt(local)).toBe('fn g():');
    expect(extentText(local)).toBe('fn g(): x');
  });

  it("give each of a trait's members on lines of their own a header, ending the trait's span", () => {
    expect(textAt(t)).toBe('trait T:');
    expect(t.members.map((member) => member.span.segment.kind)).toEqual(['header', 'header']);
    expect(new Set([t, ...t.members].map((node) => node.span.segment)).size).toBe(3);
    expect(extentText(t)).toBe('trait T:\n  fn m()\n  n: int');
  });

  it("keep a trait's members on its line inside it", () => {
    const oneLine = parseText('trait C: fn m()\n');
    const [trait] = oneLine.root.items;
    if (trait?.kind !== 'TraitDeclaration') {
      throw new Error('Expected a trait.');
    }
    expect(trait.members.map((member) => member.span.segment)).toEqual([trait.span.segment]);
    expect(textOf(oneLine.source, spanIn(oneLine, trait.span))).toBe('trait C: fn m()');
  });

  it("keep a trait's members in braces inside it", () => {
    expect(
      b.kind === 'TraitDeclaration' && b.members.every((m) => m.span.segment === b.span.segment),
    ).toBe(true);
    expect(textAt(b)).toBe('trait B { fn m() }');
  });

  it("hold every node in its parent's segment, but for items, members and bodies, over the corpus", () => {
    const heads = (within: SyntaxTree, parent: SyntaxNode, child: SyntaxNode) =>
      (child.span.segment.kind === 'header' &&
        (parent.kind === 'Module' ||
          (parent.kind === 'TraitDeclaration' && parentOf(within, parent) === within.root))) ||
      (child.span.segment.kind === 'body' && parent.kind === 'FunctionDeclaration');
    const strays = trees.flatMap((each) =>
      nodesUnder(each, each.root).flatMap((parent) =>
        childrenOf(each, parent)
          .filter(
            (child) => child.span.segment !== parent.span.segment && !heads(each, parent, child),
          )
          .map((child) => `${child.kind} in ${parent.kind}`),
      ),
    );
    expect(strays).toEqual([]);
  });

  it('order children across segments as written', () => {
    expect(childrenOf(tree, tree.root)).toEqual(tree.root.items);
    expect(childrenOf(tree, t).slice(-2)).toEqual(t.members);
  });
});

describe('bodies', () => {
  it('are of functions of their own tree, over every corpus program and example', () => {
    expect(trees.flatMap(strayBodies)).toEqual([]);
  });

  it.each([
    ['a statement standing where an item must', 'if a: fn f(): 1'],
    ['an item standing where a statement must', 'fn g():\n  extern fn f(): 1'],
    ['a trait standing where a statement must', 'fn g():\n  trait T:\n    fn f(): 1'],
    ['an else misplaced in a select', 'fn g():\n  select:\n    else: fn f(): 1\n    case x: 1'],
    ['a tuple element of a block', 'fn g(): { fn f(): 1 }.01'],
    ['an annotation nothing takes', '@Foo{x: { fn f(): 1 }}'],
  ])('are of functions of their own tree after %s', (_name, text) => {
    expect(strayBodies(parseText(text))).toEqual([]);
  });

  it('are of functions of their own tree, over any text, however broken', () => {
    fc.assert(
      fc.property(anyText, (tree) => {
        expect(strayBodies(tree)).toEqual([]);
      }),
    );
  });
});

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
