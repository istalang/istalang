/**
 * Dropped variables (§7): `drop x` releases `x`, which can't be used afterwards. A use that some
 * path reaches from a drop, with no assignment to `x` between, is an error; assigning a `let`
 * again makes it usable, and a declaration run again, as in a loop's next iteration, is a fresh
 * variable.
 *
 * - A body's flow (rules/flow/) is run forward once its checking is done: what was dropped on any
 *   path flows on, joining where paths meet, so a drop late in a loop's body is seen by a use early
 *   in it.
 * - A use is a copy out of a variable at its name, or a place rooted at a variable it names; an
 *   operation writing into a variable declares or assigns it, which makes it usable.
 * - A lambda or local function captures what it uses when it is made, so its own flow runs from
 *   what was dropped where its closure is made, and its own variables flow within it.
 */

import type { VariableEntity } from '../../../binder/entities.ts';
import type { Identifier, NodeOf } from '../../../syntax/tree/node.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { FlowFunction, Operation, Place, ValueId } from '../../surface/flow-ir.ts';
import { type ForwardRule, runForward } from '../flow/solve.ts';

/** The variables dropped on some path to a point. */
type Dropped = ReadonlySet<VariableEntity>;

/** Reports every use of a variable after a `drop` reaches it, in `flow` and what it makes. */
export function checkDropped(context: BodyContext, flow: FlowFunction): void {
  new DroppedUses(context).run(flow, new Set());
}

/** The uses after a drop found so far, each reported once, at its name. */
class DroppedUses {
  readonly #context: BodyContext;
  readonly #reported = new Set<Identifier>();

  constructor(context: BodyContext) {
    this.#context = context;
  }

  /** Runs `flow` from `entry`, reporting what it uses after a drop. */
  run(flow: FlowFunction, entry: Dropped): void {
    const rule: ForwardRule<Dropped> = {
      join: (states) => new Set(states.flatMap((state) => [...state])),
      settled: (earlier, later) => later.size === earlier.size,
      operation: (operation, dropped) => this.#operation(flow, operation, dropped),
    };
    runForward(flow, rule, entry);
  }

  #operation(flow: FlowFunction, operation: Operation, dropped: Dropped): Dropped {
    for (const [value, at] of usesOf(operation)) {
      const variable = variableOf(flow, value);
      if (variable !== undefined && at?.kind === 'Identifier' && dropped.has(variable)) {
        this.#report(at as Identifier);
      }
    }
    if (operation.op === 'make' && operation.made.kind === 'closure') {
      this.run(operation.made.function, dropped);
    }
    return droppedAfter(flow, operation, dropped);
  }

  #report(name: Identifier): void {
    if (!this.#reported.has(name)) {
      this.#reported.add(name);
      this.#context.report(checkerDiagnostics.droppedVariableUsed(name.span, name.text));
    }
  }
}

/**
 * What is dropped after `operation`: its `drop`'s variables, less any variable it writes or a
 * scope it ends releases, which a later declaration makes afresh.
 */
function droppedAfter(flow: FlowFunction, operation: Operation, dropped: Dropped): Dropped {
  if (operation.op === 'release') {
    const variables = operation.values.flatMap((value) => variableOf(flow, value) ?? []);
    return operation.reason === 'drop'
      ? new Set([...dropped, ...variables])
      : variables.reduce(without, dropped);
  }
  const assigned = 'into' in operation ? variableOf(flow, operation.into) : undefined;
  return assigned === undefined ? dropped : without(dropped, assigned);
}

function variableOf(flow: FlowFunction, value: ValueId): VariableEntity | undefined {
  const found = flow.values[value];
  return found?.kind === 'variable' ? found.entity : undefined;
}

/** The variables `operation` uses, each with the node naming it. */
function usesOf(operation: Operation): readonly (readonly [ValueId, NodeOf<string> | undefined])[] {
  const placeUse = (place: Place) => [place.root, place.name] as const;
  switch (operation.op) {
    case 'copy':
      return [[operation.from, operation.site]];
    case 'write':
      return [placeUse(operation.place)];
    case 'call':
    case 'callValue':
      return operation.arguments.flatMap((argument) =>
        argument.kind === 'place' ? [placeUse(argument.place)] : [],
      );
    default:
      return [];
  }
}

function without(dropped: Dropped, variable: VariableEntity): Dropped {
  if (!dropped.has(variable)) {
    return dropped;
  }
  const remaining = new Set(dropped);
  remaining.delete(variable);
  return remaining;
}
