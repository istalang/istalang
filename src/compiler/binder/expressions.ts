/**
 * Binding names in expressions (§2–§4, §3.11, §3.14). Where the bindings of a condition, case or
 * comprehension are visible is flow.ts's rule.
 *
 * `a.b.c` is bound as a qualified name only when its head may be a module namespace or an enum:
 * otherwise every part after the head is a member, which the checker resolves by type.
 */

import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import type { Expression, MemberAccess, Spread } from '../syntax/expressions.ts';
import type { Identifier, QualifiedName } from '../syntax/node.ts';
import { underBindings, underCondition, underLoop } from './flow.ts';
import { holdsNoNames, type LocalBinder } from './local-binder.ts';
import type { Scope } from './scope.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const expressionHandlers: Handlers<LocalBinder, Expression, [Scope], void> = {
  Identifier: (binder, node, scope) => binder.use(node, scope, 'value'),
  IntegerLiteral: holdsNoNames,
  FloatLiteral: holdsNoNames,
  DurationLiteral: holdsNoNames,
  StringLiteral: holdsNoNames,
  BooleanLiteral: holdsNoNames,
  NoneLiteral: holdsNoNames,
  Missing: holdsNoNames,
  Invalid: holdsNoNames,
  ArrayLiteral: (binder, node, scope) => bindAll(binder, node.elements, scope),
  MapLiteral: (binder, node, scope) => {
    for (const entry of node.entries) {
      if (entry.kind === 'MapEntry') {
        bindAll(binder, [entry.key, entry.value], scope);
      } else if (entry.kind === 'Spread') {
        bindAll(binder, [entry], scope);
      }
    }
  },
  Tuple: (binder, node, scope) => bindAll(binder, node.elements, scope),
  Parenthesized: (binder, node, scope) => bindExpression(binder, node.expression, scope),
  Reference: (binder, node, scope) => bindExpression(binder, node.expression, scope),
  Propagate: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Unwrap: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Unary: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Await: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Index: (binder, node, scope) => bindAll(binder, [node.target, node.index], scope),
  Range: (binder, node, scope) => bindAll(binder, [node.start, node.end], scope),
  Call: (binder, node, scope) => {
    if (node.callee.kind === 'Identifier') {
      binder.use(node.callee, scope, 'callee');
    } else {
      bindExpression(binder, node.callee, scope);
    }
    for (const argument of node.typeArguments) {
      binder.walk.type(binder, argument, scope);
    }
    bindAll(binder, node.arguments, scope);
  },
  TupleElement: (binder, node, scope) => bindExpression(binder, node.target, scope),
  MemberAccess: (binder, node, scope) => {
    const path = qualifiedPathOf(node);
    if (path === undefined) {
      bindExpression(binder, node.target, scope);
    } else {
      binder.memberPath(path, scope);
    }
  },
  Binary: bindValueCondition,
  Is: bindValueCondition,
  StructLiteral: (binder, node, scope) => {
    if (node.type !== undefined) {
      binder.constructedType(node.type, scope);
    }
    for (const item of node.items) {
      if (item.kind === 'FieldInitializer') {
        // The shorthand `Pair{first}` reads the variable named like the field.
        bindFieldValue(binder, item.name, item.value, scope);
      } else if (item.kind !== 'Invalid') {
        bindAll(binder, [item.kind === 'Spread' ? item : item.value], scope);
      }
    }
  },
  Lambda: (binder, node, scope) => binder.walk.function(binder, node, scope),
  BlockExpression: (binder, node, scope) => binder.walk.block(binder, node.block, scope),
  Comprehension: (binder, node, scope) =>
    underLoop(binder, node, scope, (variables) =>
      underCondition(binder, node.condition, variables, (flow) =>
        bindExpression(binder, node.body, flow),
      ),
    ),
  If: (binder, node, scope) => {
    for (const branch of node.branches) {
      underCondition(binder, branch.condition, scope, (flow) =>
        binder.walk.block(binder, branch.body, flow),
      );
    }
    if (node.elseClause !== undefined) {
      binder.walk.block(binder, node.elseClause.body, scope);
    }
  },
  Match: (binder, node, scope) => {
    bindExpression(binder, node.subject, scope);
    for (const matchCase of node.cases) {
      if (matchCase.kind === 'MatchCase') {
        underBindings(
          scope,
          (bindings) => binder.walk.pattern(binder, matchCase.pattern, scope, { into: bindings }),
          (bindings) =>
            underCondition(binder, matchCase.guard, bindings, (flow) =>
              binder.walk.block(binder, matchCase.body, flow),
            ),
        );
      }
    }
  },
  Select: (binder, node, scope) => {
    for (const selectCase of node.cases) {
      if (selectCase.kind === 'SelectCase') {
        bindExpression(binder, selectCase.future, scope);
        const name = selectCase.binding;
        const define = (bindings: Scope) => {
          if (name !== undefined) {
            binder.declareVariable(bindings, name, selectCase);
          }
        };
        underBindings(scope, define, (bindings) =>
          binder.walk.block(binder, selectCase.body, bindings),
        );
      }
    }
    if (node.elseClause !== undefined) {
      binder.walk.block(binder, node.elseClause.body, scope);
    }
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

export function bindExpression(binder: LocalBinder, node: Expression, scope: Scope): void {
  handlerOf(expressionHandlers, node)(binder, node, scope);
}

/** An `is` or `and`/`or` used as a value: its bindings reach only its own right-hand sides. */
function bindValueCondition(binder: LocalBinder, node: Expression, scope: Scope): void {
  underCondition(binder, node, scope, () => undefined);
}

function bindAll(
  binder: LocalBinder,
  nodes: readonly (Expression | Spread | undefined)[],
  scope: Scope,
): void {
  for (const node of nodes) {
    if (node?.kind === 'Spread') {
      bindExpression(binder, node.expression, scope);
    } else if (node !== undefined) {
      bindExpression(binder, node, scope);
    }
  }
}

function bindFieldValue(
  binder: LocalBinder,
  name: Identifier,
  value: Expression | undefined,
  scope: Scope,
): void {
  if (value === undefined) {
    binder.use(name, scope, 'value');
  } else {
    bindExpression(binder, value, scope);
  }
}

/** `a.b.c` as the parts of a name, when every link is a plain `.` from a name. */
function qualifiedPathOf(node: MemberAccess): QualifiedName | undefined {
  const members: Identifier[] = [];
  let current: Expression = node;
  while (current.kind === 'MemberAccess' && !current.isOptional) {
    members.unshift(current.member);
    current = current.target;
  }
  return current.kind === 'Identifier' ? [current, ...members] : undefined;
}
