/**
 * What each operation of the flow IR does to the analysis's state (design.md §5.2), by kind.
 *
 * - **Only values whose type may reach a disposable are followed** (`isRelevant`): a cycle through
 *   a holder reaching one passes only through such values, since each reaches the holder.
 * - **A copy** relates its target as its source; assigning a captured `let` also writes its cell,
 *   a heap write like any (design.md §2), and declaring one makes the cell.
 * - **A read** of a variable's or path's part reads that path, so reading it again names one value
 *   (nodes.ts); a read of any other value reaches what it reaches.
 * - **A closure** is analysed as its own function, once; it holds what it captures, which escapes,
 *   since the closure may be called by code nobody sees, and its requirements are checked for any
 *   values of its inputs' types where it is made (design.md §5.5). So are a function's named as a
 *   value, which nothing it captures holds.
 * - **An `await`'s own `onAwait`** is a call like any, of the awaitable's own `onAwait`, a user's
 *   or a generic's among them; it isn't given the wait's case, which holds nothing past the wait
 *   (design.md §3), so a `Future`'s keeping of it relates nothing.
 * - **The std's cursors** (`iterate`) give the items of what they iterate, and run nothing else:
 *   each is a closure of the std reading its own value, which a summary can't say of a function
 *   it gives back (design.md §5.6).
 */

import type { FunctionCall, RequirementCall } from '../../../surface/resolved-call.ts';
import type { Type } from '../../../types/type/index.ts';
import type { Operation } from '../../flow/flow-ir.ts';
import { boundBy, joinedSummaries } from '../composition.ts';
import { escapingCycles } from '../escaping.ts';
import { type Input, inputKey } from '../input.ts';
import type { NodeId } from '../reach-state.ts';
import type { Summary } from '../summary.ts';
import { type At, closureBindings, functionBindings, nodesGiven } from './bindings.ts';
import { type BodyAnalysis, placeHolds } from './body.ts';
import { applySummary, unknownCall } from './calls.ts';
import { type FlowState, materialize } from './flow-state.ts';
import { giveValue, withDefaults } from './given.ts';
import { readKindOf } from './nodes.ts';
import { placeTarget } from './places.ts';

type Of<Kind extends Operation['op']> = Extract<Operation, { op: Kind }>;

type Handler<Kind extends Operation['op']> = (at: At, operation: Of<Kind>) => void;

const handlers: { readonly [Kind in Operation['op']]: Handler<Kind> } = {
  compute: (at, { into }) => fresh(at, into),
  unknown: (at, { into }) => fresh(at, into),
  copy: (at, operation) => {
    if (!at.analysis.nodes.isRelevant(operation.into)) {
      return;
    }
    const value = at.analysis.nodes.flow.values[operation.into];
    if (value?.kind === 'variable') {
      assigned(at, operation);
    } else if (value?.kind === 'temporary') {
      copied(at, operation);
    }
  },
  read: (at, operation) => {
    const { analysis, state } = at;
    const { into, from, part } = operation;
    if (!analysis.nodes.isRelevant(into)) {
      return;
    }
    const gives = part.kind === 'given' ? state.gives.get(from) : undefined;
    if (!state.reach.isLive(from)) {
      state.reach.fresh(into);
    } else if (gives === undefined) {
      readOf(at, operation);
    } else {
      giveValue(at, into, gives);
    }
  },
  write: ({ analysis, state }, { place, value, site }) => {
    if (!(state.reach.isLive(value) && analysis.nodes.isRelevant(value))) {
      return;
    }
    const target = placeTarget(analysis, state, place);
    const { owner } = target;
    if (owner.kind === 'heap') {
      analysis.write(state, owner.holder, value, site);
      placeHolds(state, owner.holder, target.value, value);
      return;
    }
    const type = analysis.nodes.typeOf(owner.variable);
    if (owner.kind === 'reference' && type !== undefined) {
      analysis.lift(state, owner.variable, value, {
        holderType: type,
        kind: 'reach',
        lands: 'place',
      });
    }
    state.reach.contain(owner.variable, value);
    analysis.endPathsFrom(state, owner.variable);
  },
  make: (at, operation) => {
    const { analysis, state } = at;
    const { into, made, parts } = operation;
    if (made.kind === 'closure') {
      madeClosure(at, operation);
      return;
    }
    const named =
      made.kind === 'function' && made.call.kind === 'function'
        ? functionInputs(analysis, made.call)
        : undefined;
    if (named !== undefined) {
      checkEscaping(at, operation.site, named, 'closure');
    }
    if (!analysis.nodes.isRelevant(into)) {
      return;
    }
    state.reach.fresh(into);
    for (const part of parts.filter((each) => state.reach.isLive(each))) {
      if (made.kind === 'handle') {
        state.reach.hold(into, part);
      } else if (made.kind !== 'function') {
        state.reach.contain(into, part);
      }
    }
    if (made.kind === 'struct' || made.kind === 'tuple') {
      madeParts(at, operation);
    }
  },
  call: (at, operation) => {
    const { into, call, role, arguments: args, site } = operation;
    const { analysis } = at;
    if (call.kind === 'requirement') {
      const witnesses = analysis.context.witnessesOf(call);
      if (witnesses === undefined) {
        // Code this body can't see; the witnesses a call gives are checked by types (calls.ts).
        unknownCall(at, into, nodesGiven(at, args));
      } else {
        dispatchedCall(at, operation, call, witnesses);
      }
      return;
    }
    const summary = analysis.context.calleeSummary(call);
    if (summary === undefined) {
      unknownCall(at, into, nodesGiven(at, args));
      return;
    }
    const bindings = withDefaults(at, operation, functionBindings(at, call, args));
    const isAsync = call.function.qualifiers.async !== undefined;
    applySummary(at, { site, into, callee: call.function, call, isAsync }, summary, bindings);
    if (role === 'iterate' && analysis.context.readsWhatItIterates(call.function)) {
      cursorOver(at, into, nodesGiven(at, args));
    }
  },
  callValue: (at, { into, callee, arguments: args, site }) => {
    const { analysis, state } = at;
    const known = state.callees.get(callee);
    if (known?.kind === 'items') {
      if (analysis.nodes.isRelevant(into)) {
        state.reach.fresh(into);
        state.reach.readThrough(into, callee);
      }
    } else if (known === undefined) {
      const own = analysis.calledInput(state, callee);
      unknownCall(at, into, [callee, ...nodesGiven(at, args)], own === undefined);
    } else {
      const made = { site, into, callee: undefined, call: undefined, isAsync: known.isAsync };
      applySummary(at, made, known.summary, closureBindings(at, known, callee, args));
    }
  },
  suspend: ({ analysis, state }) => {
    analysis.runUnseen(state);
  },
  release: ({ analysis, state }, { values }) => {
    for (const value of values) {
      analysis.release(state, value);
    }
  },
};

/**
 * A call through an `any` value (design.md §5.4): what each of the witnesses it may run does,
 * over the required function's parameters, joined, applied as one call's.
 */
function dispatchedCall(
  at: At,
  operation: Of<'call'>,
  call: RequirementCall,
  witnesses: readonly FunctionCall[],
): void {
  const { into, site, arguments: args } = operation;
  const { context } = at.analysis;
  const summaries = witnesses.flatMap((witness) => {
    const summary = context.calleeSummary(witness);
    return summary === undefined
      ? []
      : [boundBy(summary, witness.binding, (type) => context.substitute(type, witness))];
  });
  const isAsync = witnesses.some((witness) => witness.function.qualifiers.async !== undefined);
  const made = { site, into, callee: undefined, call: undefined, isAsync };
  const bindings = withDefaults(at, operation, functionBindings(at, call, args));
  applySummary(at, made, joinedSummaries(summaries), bindings);
}

/**
 * `cursor`, a native `iterate`'s, holds what it was given to iterate, which the calls of it read
 * an item of each (`KnownFunction`): the iterated value may end before the loop does.
 */
function cursorOver({ state }: At, cursor: NodeId, iterated: readonly NodeId[]): void {
  state.callees.set(cursor, { kind: 'items' });
  if (state.reach.isLive(cursor)) {
    for (const each of iterated.filter((node) => state.reach.isLive(node))) {
      state.reach.hold(cursor, each);
    }
  }
}

/** Runs `operation` on `state`, then ends the temporaries it used last. */
export function runOperation(analysis: BodyAnalysis, state: FlowState, operation: Operation): void {
  (handlers[operation.op] as Handler<typeof operation.op>)({ analysis, state }, operation as never);
  for (const value of analysis.nodes.defaultsOf(operation)) {
    state.reach.kill(value);
  }
  // A temporary a future settles with is read where the future is awaited: it lives till then.
  const given = new Set(
    [...state.gives.values()].flatMap(({ relations }) => relations.map(({ node }) => node)),
  );
  for (const ended of analysis.nodes.endingAfter(operation)) {
    if (!given.has(ended)) {
      analysis.release(state, ended);
    }
  }
}

/** A value computed afresh, holding nothing it was computed from. */
function fresh({ analysis, state }: At, into: NodeId): void {
  if (analysis.nodes.isRelevant(into)) {
    state.reach.fresh(into);
  }
}

/**
 * A variable assigned or declared: a captured `let`'s cell written, or made where it is declared,
 * and the variable a copy of its value.
 */
function assigned({ analysis, state }: At, { into, from, site }: Of<'copy'>): void {
  const { nodes } = analysis;
  const placeType = nodes.typeOf(into);
  if (analysis.references.has(into) && placeType !== undefined && state.reach.isLive(from)) {
    // A reference parameter assigned whole is its caller's place written.
    analysis.lift(state, into, from, { holderType: placeType, kind: 'reach', lands: 'place' });
  }
  const cell = nodes.cell(into);
  const type = nodes.typeOf(cell);
  if (nodes.isCell(into) && type !== undefined) {
    if (!(state.reach.isLive(into) || state.reach.isLive(cell))) {
      state.reach.fresh(cell);
    }
    if (state.reach.isLive(from)) {
      analysis.write(state, { node: cell, exact: true, type }, from, site);
    }
  }
  analysis.assign(state, into, from);
  carry(state, into, from);
}

/** A temporary copied from `from`, naming what it names. */
function copied({ analysis, state }: At, { into, from }: Of<'copy'>): void {
  if (state.reach.isLive(from)) {
    state.reach.copy(into, from);
    analysis.carryPaths(state, into, from);
  } else {
    state.reach.fresh(into);
  }
  const named = analysis.canonOf(state, from);
  if (named === undefined) {
    state.canon.delete(into);
  } else {
    state.canon.set(into, named);
  }
  carry(state, into, from);
}

/** A part read: of the path a variable's or path's value names, else of the value read. */
function readOf({ analysis, state }: At, { into, from, part }: Of<'read'>): void {
  const kind = readKindOf(part);
  const root = analysis.canonOf(state, from);
  const type = analysis.nodes.typeOf(into);
  if (root !== undefined && type !== undefined && state.reach.isLive(root)) {
    const path = analysis.nodes.path(root, part, kind, type);
    if (state.reach.isLive(path) || materialize(analysis.nodes, state, path)) {
      state.reach.copy(into, path);
      state.canon.set(into, path);
      return;
    }
  }
  state.reach.fresh(into);
  if (kind === 'through') {
    state.reach.readThrough(into, from);
  } else {
    state.reach.readPart(into, from);
  }
}

/**
 * The parts of a value made here, each the path a read of it names, so reading one gives that
 * part, apart from the others (design.md §5.7).
 */
function madeParts({ analysis, state }: At, { into, made, parts }: Of<'make'>): void {
  const type = analysis.nodes.typeOf(into);
  if (type === undefined || (made.kind !== 'struct' && made.kind !== 'tuple')) {
    return;
  }
  for (const [part, node] of analysis.nodes.madeParts(type, parts, made.kind)) {
    const partType = analysis.nodes.typeOf(node);
    if (partType !== undefined && state.reach.isLive(node) && analysis.nodes.isRelevant(node)) {
      const path = analysis.nodes.path(into, part, 'part', partType);
      state.reach.copy(path, node);
      state.reach.addAlias(path, into);
    }
  }
}

/** What `into` knows, a copy of `from`: the function it is, the value it settles with. */
function carry(state: FlowState, into: NodeId, from: NodeId): void {
  const known = state.callees.get(from);
  if (known === undefined) {
    state.callees.delete(into);
  } else {
    state.callees.set(into, known);
  }
  const gives = state.gives.get(from);
  if (gives === undefined) {
    state.gives.delete(into);
  } else {
    state.gives.set(into, gives);
  }
}

/** A closure made: analysed, holding and escaping what it captures, its writes checked. */
function madeClosure(at: At, operation: Of<'make'>): void {
  const { analysis, state } = at;
  const { into, made, parts, site } = operation;
  if (made.kind !== 'closure') {
    return;
  }
  const found = analysis.analyzeNested(made.function, site);
  const relevant = analysis.nodes.isRelevant(into);
  if (relevant) {
    state.reach.fresh(into);
  }
  state.callees.set(into, {
    kind: 'closure',
    flow: made.function,
    summary: found.summary,
    parts,
    isAsync: found.isAsync,
  });
  const cells = parts.filter((part) => analysis.nodes.isCell(part));
  for (const cell of cells.map((part) => analysis.nodes.cell(part))) {
    if (!state.reach.isLive(cell) && analysis.nodes.isRelevant(cell)) {
      state.reach.fresh(cell);
    }
  }
  const captured = parts
    .map((part) => (analysis.nodes.isCell(part) ? analysis.nodes.cell(part) : part))
    .filter((node) => state.reach.isLive(node));
  for (const node of captured) {
    if (relevant) {
      state.reach.hold(into, node);
    }
    analysis.leak(state, node);
  }
  checkEscaping(
    at,
    site,
    { summary: found.summary, typeOf: (input) => found.inputTypes.get(inputKey(input)) },
    'closure',
  );
}

/** A function code nobody sees may call, with any values of its inputs' types. */
interface Escaping {
  readonly summary: Summary;
  readonly typeOf: (input: Input) => Type | undefined;
}

/** A function named as a value, which captures nothing: what it does, its parameters' types. */
function functionInputs(analysis: BodyAnalysis, call: FunctionCall): Escaping | undefined {
  const { context } = analysis;
  const summary = context.calleeSummary(call);
  if (summary === undefined) {
    return undefined;
  }
  const parameters = context.parametersOf(call.function);
  const typeOf = (input: Input) => {
    const type = input.kind === 'parameter' ? parameters[input.index]?.type : undefined;
    return type === undefined ? undefined : context.substitute(type, call);
  };
  return { summary, typeOf };
}

/**
 * Checks where an escaping function is made that no values of its inputs' types can close a cycle
 * through its writes (design.md §5.5).
 */
function checkEscaping(
  { analysis }: At,
  site: Of<'make'>['site'],
  { summary, typeOf }: Escaping,
  kind: 'closure' | 'witness',
): void {
  for (const cycle of escapingCycles(analysis.context.facts, summary, typeOf)) {
    analysis.violate(kind, site, cycle, undefined);
  }
}
