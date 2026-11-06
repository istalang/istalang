/**
 * Dropped variables (§7): `drop x` releases `x`, which can't be used afterwards. A use that some
 * path reaches from a drop, with no assignment to `x` between, is an error; assigning a `let`
 * again makes it usable, and a declaration run again, as in a loop's next iteration, is a fresh
 * variable.
 *
 * - A body is walked once its checking is done, as the code runs (flow/forward.ts): what was
 *   dropped on any path flows on, joining where paths meet, so a drop late in a loop's body is
 *   seen by a use early in it.
 * - A name is a use unless it is the one that declares its variable. Patterns, loop targets and
 *   declarations therefore need no rule of their own: their names declare, and a fresh variable
 *   is not dropped.
 * - A lambda or local function captures what it uses when it is made, so its uses count there, and
 *   its own variables flow within its own body.
 */

import type { VariableEntity } from '../../../binder/entities.ts';
import type { Identifier } from '../../../syntax/node.ts';
import { droppedName } from '../../../syntax/statements/readings.ts';
import type { SyntaxNode } from '../../../syntax/tree.ts';
import type { BodyContext } from '../../body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { flowThrough } from '../../flow/forward.ts';

/** The variables dropped on some path to a point. */
type Dropped = ReadonlySet<VariableEntity>;

/** Reports every use of a variable after a `drop` reaches it, in `body` and what it nests. */
export function checkDropped(context: BodyContext, body: SyntaxNode): void {
  const reported = new Set<Identifier>();
  const variableOf = (name: Identifier): VariableEntity | undefined => {
    const entity = context.entityOf(name);
    return entity?.kind === 'variable' ? entity : undefined;
  };
  flowThrough<Dropped>(
    {
      join: (states) => new Set(states.flatMap((state) => [...state])),
      settled: (earlier, later) => later.size === earlier.size,
      name: (name, dropped) => {
        const variable = variableOf(name);
        if (variable?.name === name) {
          return without(dropped, variable);
        }
        if (variable !== undefined && dropped.has(variable) && !reported.has(name)) {
          reported.add(name);
          context.report(checkerDiagnostics.droppedVariableUsed(name.span, name.text));
        }
        return dropped;
      },
      assign: (name, dropped) => {
        const variable = variableOf(name);
        return variable === undefined ? dropped : without(dropped, variable);
      },
      drop: (node, dropped) => {
        const name = droppedName(node);
        const variable = name === undefined ? undefined : variableOf(name);
        return variable === undefined ? dropped : new Set([...dropped, variable]);
      },
    },
    {
      root: body,
      labels: context.labels,
      bodyOf: (declaration) => context.checker.inputs.bodyOf(context.module, declaration),
    },
    new Set(),
  );
}

function without(dropped: Dropped, variable: VariableEntity): Dropped {
  if (!dropped.has(variable)) {
    return dropped;
  }
  const remaining = new Set(dropped);
  remaining.delete(variable);
  return remaining;
}
