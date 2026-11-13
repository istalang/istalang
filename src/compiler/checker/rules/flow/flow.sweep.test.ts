/**
 * A body's flow holds everything checking recorded of it (flow-ir.ts): over every corpus program
 * and spec example, each expression checking typed has a value at its node, or is part of a place
 * the flow writes or passes by `&`; and each call the body makes, written or implicit, is a call
 * of the flow, or a function it names as a value; and a program checking accepts runs no code of
 * unknown value. Its every body is swept: functions', defaults', and constants' initializers. Two
 * calls checking records are never made: the
 * `index` of an element an assignment writes with `setIndex` alone (build/places.ts), and an array
 * pattern's item or rest no test or binding reads, as a wildcard's.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../../../test/corpus/programs.ts';
import { specExamples } from '../../../../../test/corpus/spec-examples.ts';
import { isError } from '../../../../foundation/diagnostics/diagnostic.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnoseModule } from '../../../compile.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { functionsOf } from '../../../syntax/declarations/field-defaults.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import { defaultValuesOf } from '../../../syntax/expressions/parameters.ts';
import { placePath } from '../../../syntax/expressions/places.ts';
import { calledName } from '../../../syntax/expressions/readings.ts';
import type { Block } from '../../../syntax/statements/index.ts';
import { bodyOf, type SyntaxNode, type SyntaxTree } from '../../../syntax/tree/index.ts';
import { spanIn } from '../../../syntax/tree/positions.ts';
import { type Checker, checkProgram, type SignatureParameter } from '../../check.ts';
import { type CheckedBody, checkedChildrenOf } from '../../surface/checked-body.ts';
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
  /** Where code checking found a mistake in runs, which a program it accepts has none of. */
  readonly unknown: SyntaxNode[];
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
  if (operation.op === 'unknown') {
    held.unknown.push(operation.site as SyntaxNode);
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

/**
 * A function's body as checked, its local functions' too, walked node by node, a sugar's core in
 * its place.
 */
function walk(
  root: SyntaxNode,
  { local, body }: { readonly local: Local; readonly body: CheckedBody },
  visit: (node: SyntaxNode) => void,
): void {
  visit(root);
  const nested = root.kind === 'FunctionDeclaration' ? local(root) : undefined;
  const children = checkedChildrenOf(root, body.coreOf);
  for (const child of [...children, ...(nested === undefined ? [] : [nested])]) {
    walk(child, { local, body }, visit);
  }
}

/** The callees under `root`: the names of the functions resolved calls call. */
function calleesUnder(body: CheckedBody, root: SyntaxNode, local: Local): ReadonlySet<unknown> {
  const callees = new Set<unknown>();
  walk(root, { local, body }, (node) => {
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
  walk(root, { local, body }, (node) => {
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
  flows: readonly FlowFunction[],
  { body, roots }: { readonly body: CheckedBody; readonly roots: readonly SyntaxNode[] },
  context: {
    readonly local: Local;
    readonly textOf: (node: SyntaxNode) => string;
    readonly clean: boolean;
  },
): readonly string[] {
  const { local, textOf } = context;
  const held: Held = { nodes: new Set(), calls: new Set(), written: new Set(), unknown: [] };
  for (const flow of flows) {
    heldBy(flow, held);
  }
  const missing: string[] = [];
  for (const root of roots) {
    const callees = calleesUnder(body, root, local);
    walk(root, { local, body }, (node) => {
      const typed = body.typeOf(node as Expression) !== undefined;
      if (typed && !callees.has(node) && !held.nodes.has(node)) {
        missing.push(`no value of ${textOf(node)}`);
      }
    });
  }
  const neverMadeIn = roots.map((root) => neverMade(body, root, local, held));
  for (const made of body.madeCalls()) {
    if (!(held.calls.has(made.call) || neverMadeIn.some((isNeverMade) => isNeverMade(made)))) {
      missing.push(
        `no call of ${made.call.function.name.text} at ${textOf(made.site as SyntaxNode)}`,
      );
    }
  }
  if (context.clean) {
    missing.push(...held.unknown.map((site) => `an unknown value at ${textOf(site)}`));
  }
  return missing;
}

/**
 * A body checking checked, and the roots its flows start at, each with the parameters it takes:
 * a function's block, each of its defaults, a constant's initializer.
 */
interface Rooted {
  readonly body: CheckedBody;
  readonly roots: readonly {
    readonly root: Block | Expression;
    readonly parameters: readonly SignatureParameter[];
  }[];
}

/**
 * Every body of `tree`'s module: each function's, its fields functions' among them, and their
 * defaults, each default a root of its own; each constant's and context constant's initializer.
 */
function rootsOf(checker: Checker, tree: SyntaxTree): readonly Rooted[] {
  const functions = functionsOf(tree.root).flatMap((declaration): Rooted[] => {
    const body = checker.bodyOf(declaration);
    const block = bodyOf(tree, declaration);
    const parameters = checker.parametersOf(declaration);
    const own =
      body === undefined || block === undefined
        ? []
        : [{ body, roots: [{ root: block, parameters }] }];
    const defaults = checker.defaultsOf(declaration);
    const values = defaultValuesOf(declaration.parameters);
    const given = values.map((root) => ({ root, parameters: [] }));
    return [...own, ...(defaults === undefined ? [] : [{ body: defaults, roots: given }])];
  });
  const constants = tree.root.items.flatMap((item): Rooted[] => {
    if (item.kind === 'VariableDeclaration') {
      const body = checker.constantBodyOf(item);
      return body === undefined
        ? []
        : [{ body, roots: [{ root: item.initializer, parameters: [] }] }];
    }
    if (item.kind === 'ContextConstantDeclaration') {
      const body = checker.contextConstants.bodyOf(item);
      return [{ body, roots: [{ root: item.initializer, parameters: [] }] }];
    }
    return [];
  });
  return [...functions, ...constants];
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
    const clean = !diagnoseModule(program, module).diagnostics.some(isError);
    const missing = rootsOf(checker, tree).flatMap(({ body, roots }) => {
      const inputs = { checker, module, localBodyOf: local, body };
      const flows = roots.map(({ root, parameters }) => flowOf(inputs, root, parameters));
      const nodes = roots.map(({ root }) => root);
      return missedBy(flows, { body, roots: nodes }, { local, textOf, clean });
    });
    expect(missing).toEqual([]);
  });
});
