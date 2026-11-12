/**
 * A body's flow holds everything checking recorded of it (flow-ir.ts): over every corpus program
 * and spec example, each expression checking typed has a value at its node, or is part of a place
 * the flow writes or passes by `&`; and each call the body makes, written or implicit, is a call
 * of the flow, or a function it names as a value. Two calls checking records are never made: the
 * `index` of an element an assignment writes with `setIndex` alone (build/places.ts), and an array
 * pattern's item or rest no test or binding reads, as a wildcard's.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../../../test/corpus/programs.ts';
import { specExamples } from '../../../../../test/corpus/spec-examples.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import { placePath } from '../../../syntax/expressions/places.ts';
import { calledName } from '../../../syntax/expressions/readings.ts';
import type { Block } from '../../../syntax/statements/index.ts';
import {
  bodyOf,
  fieldChildrenOf,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../syntax/tree/index.ts';
import { spanIn } from '../../../syntax/tree/positions.ts';
import { type Checker, checkProgram } from '../../check.ts';
import type { CheckedBody } from '../../surface/checked-body.ts';
import type { CheckedPattern, PartStep } from '../../surface/checked-pattern.ts';
import type { MadeCall, ResolvedCall } from '../../surface/resolved-call.ts';
import { flowOf } from './build/index.ts';
import type { FlowFunction, Operation, Place } from './flow-ir.ts';

const programs = [
  ...runPrograms.map(({ name, text }) => ({ name, text })),
  ...specExamples
    .filter((example) => example.form === 'module' && !example.elided)
    .map((example) => ({ name: `${example.document}:${example.line}`, text: example.code })),
];

/** A function's local functions' bodies, which its tree holds apart. */
type Local = (node: FunctionDeclaration) => Block | undefined;

/** What a flow and the flows it makes hold. */
interface Held {
  /** The nodes their temporaries are of, and the nodes of the places they name. */
  readonly nodes: Set<unknown>;
  readonly calls: Set<ResolvedCall>;
  /** The elements written with `setIndex`. */
  readonly written: Set<unknown>;
}

/** What `flow` and the flows it makes hold, added to `held`. */
function heldBy(flow: FlowFunction, held: Held): Held {
  for (const value of flow.values) {
    if (value.kind === 'temporary') {
      held.nodes.add(value.site);
    }
  }
  for (const { operations } of flow.blocks) {
    for (const operation of operations) {
      holdOperation(operation, held);
    }
  }
  return held;
}

function holdOperation(operation: Operation, held: Held): void {
  for (const place of placesOf(operation)) {
    holdPlace(place, held);
  }
  if (operation.op === 'call') {
    held.calls.add(operation.call);
    if (operation.role === 'write') {
      held.written.add(operation.site);
    }
  } else if (operation.op === 'make' && operation.made.kind === 'function') {
    held.calls.add(operation.made.call);
  } else if (operation.op === 'make' && operation.made.kind === 'closure') {
    heldBy(operation.made.function, held);
  }
}

function placesOf(operation: Operation): readonly Place[] {
  if (operation.op === 'write') {
    return [operation.place];
  }
  const passed = operation.op === 'call' || operation.op === 'callValue' ? operation.arguments : [];
  return passed.flatMap((argument) => (argument.kind === 'place' ? [argument.place] : []));
}

/** A place's nodes: the expression naming it and each target down to its root, parentheses too. */
function holdPlace(place: Place, held: Held): void {
  const { root } = placePath(place.site);
  let node: Expression = place.site;
  held.nodes.add(node);
  while (node !== root) {
    node =
      node.kind === 'Parenthesized' ? node.expression : (node as { target: Expression }).target;
    held.nodes.add(node);
  }
}

/** A function's body, its local functions' too, walked node by node. */
function walk(root: SyntaxNode, local: Local, visit: (node: SyntaxNode) => void): void {
  visit(root);
  const nested = root.kind === 'FunctionDeclaration' ? local(root) : undefined;
  for (const child of [...fieldChildrenOf(root), ...(nested === undefined ? [] : [nested])]) {
    walk(child, local, visit);
  }
}

/** The callees under `root`: the names of the functions resolved calls call. */
function calleesUnder(body: CheckedBody, root: SyntaxNode, local: Local): ReadonlySet<unknown> {
  const callees = new Set<unknown>();
  walk(root, local, (node) => {
    if ((node.kind === 'Call' || node.kind === 'DeferredCall') && body.resolved.has(node)) {
      const callee = calledName(node);
      callees.add(callee);
      callees.add(callee.kind === 'TypeApplication' ? callee.target : callee);
    }
  });
  return callees;
}

/** The roles of the array reads the patterns under `root` make, by site. */
function arrayReadsUnder(body: CheckedBody, root: SyntaxNode, local: Local) {
  const reads = new Map<unknown, Set<string>>();
  const note = (path: readonly PartStep[]) => {
    for (const step of path) {
      if (typeof step === 'object' && 'site' in step) {
        reads.set(step.site, new Set([...(reads.get(step.site) ?? []), step.kind]));
      }
    }
  };
  const noteAll = (pattern: CheckedPattern): void => {
    for (const binding of pattern.bindings) {
      note(binding.path);
    }
    for (const test of pattern.tests) {
      if (test.kind === 'or') {
        test.alternatives.forEach(noteAll);
      } else if (test.kind !== 'never') {
        note(test.path);
      }
    }
  };
  walk(root, local, (node) => {
    const pattern = node.kind === 'MatchCase' || node.kind === 'Is' ? node.pattern : undefined;
    const checked = pattern === undefined ? undefined : body.patternOf(pattern);
    if (checked !== undefined) {
      noteAll(checked);
    }
  });
  return reads;
}

/** Whether a call checking recorded is one never made (this file's banner). */
function neverMade(body: CheckedBody, root: SyntaxNode, local: Local, held: Held) {
  const reads = arrayReadsUnder(body, root, local);
  return ({ site, call }: MadeCall) =>
    (held.written.has(site) && body.resolved.get(site as never) === call) ||
    (['item', 'rest'] as const).some(
      (role) => body.implicitCallOf(site, role) === call && reads.get(site)?.has(role) !== true,
    );
}

/** What `flow` misses of what checking recorded of `body`, whose block is `root`. */
function missedBy(
  flow: FlowFunction,
  { body, root }: { readonly body: CheckedBody; readonly root: SyntaxNode },
  { local, textOf }: { readonly local: Local; readonly textOf: (node: SyntaxNode) => string },
): readonly string[] {
  const held = heldBy(flow, { nodes: new Set(), calls: new Set(), written: new Set() });
  const callees = calleesUnder(body, root, local);
  const missing: string[] = [];
  walk(root, local, (node) => {
    const typed = body.typeOf(node as Expression) !== undefined;
    if (typed && !callees.has(node) && !held.nodes.has(node)) {
      missing.push(`no value of ${textOf(node)}`);
    }
  });
  const isNeverMade = neverMade(body, root, local, held);
  for (const made of body.madeCalls()) {
    if (!(held.calls.has(made.call) || isNeverMade(made))) {
      missing.push(
        `no call of ${made.call.function.name.text} at ${textOf(made.site as SyntaxNode)}`,
      );
    }
  }
  return missing;
}

/** The functions of `tree`'s module, each with its checked body and its block. */
function functionsOf(checker: Checker, tree: SyntaxTree) {
  return tree.root.items.flatMap((item) => {
    if (item.kind !== 'FunctionDeclaration') {
      return [];
    }
    const body = checker.bodyOf(item);
    const block = bodyOf(tree, item);
    return body === undefined || block === undefined ? [] : [{ declaration: item, body, block }];
  });
}

/** A loaded module's tree; every program here loads its `main`. */
function treeOf(module: { readonly tree: SyntaxTree } | undefined): SyntaxTree {
  if (module === undefined) {
    throw new Error('The program has no main module.');
  }
  return module.tree;
}

describe("a body's flow", () => {
  it.each(programs)('holds what checking recorded of $name', ({ text }) => {
    const program = stdProgramOf({ main: text });
    const checker = checkProgram(program);
    const module = idOf('main');
    const tree = treeOf(program.modules.get(module));
    const local: Local = (declaration) => bodyOf(tree, declaration);
    const textOf = (node: SyntaxNode) => {
      const { start, end } = spanIn(tree, node.span);
      return `${node.kind} ${text.slice(start, end).slice(0, 40)}`;
    };
    const inputs = {
      checker: {
        ...checker,
        inputs: { bodyOf: (_: unknown, node: FunctionDeclaration) => local(node) },
      },
      module,
    };
    const missing = functionsOf(checker, tree).flatMap(({ declaration, body, block }) => {
      const flow = flowOf({ ...inputs, body }, block, declaration.parameters);
      return missedBy(flow, { body, root: block }, { local, textOf });
    });
    expect(missing).toEqual([]);
  });
});
