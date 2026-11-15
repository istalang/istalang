/**
 * Binding names in expressions (§2–§4, §3.11, §3.14). Where the bindings of a condition, case or
 * comprehension are visible is module/flow.ts's rule.
 *
 * `a.b.c` is bound as a qualified name only when its head may be a module namespace or an enum:
 * otherwise every part after the head is a member, which the checker resolves by type. A head
 * naming a function denotes its call instead (§7, module/local-binder.ts `useBeforeMember`).
 */

import { type Handlers, handlerOf } from '../../../foundation/structures/kind-table.ts';
import { argumentValue } from '../../syntax/expressions/arguments.ts';
import type { CallArgument } from '../../syntax/expressions/calls.ts';
import type {
  Expression,
  FieldsLiteral,
  IndentedEntry,
  IndentedValue,
} from '../../syntax/expressions/index.ts';
import { qualifiedPath } from '../../syntax/expressions/readings.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import {
  bindConditionValue,
  underBindings,
  underCondition,
  underFields,
  underLoop,
} from '../module/flow.ts';
import { bindRejected, holdsNoNames, type LocalBinder, type Role } from '../module/local-binder.ts';
import type { Scope } from '../module/scope.ts';

/**
 * An expression that may name what it means, used as `role` says: a name, or one given type
 * arguments (§3.5), whose types are bound too; any other expression is bound as itself.
 */
function bindNamed(binder: LocalBinder, node: Expression, scope: Scope, role: Role): void {
  switch (node.kind) {
    case 'Identifier':
      binder.use(node, scope, role);
      return;
    case 'TypeApplication':
      bindNamed(binder, node.target, scope, role);
      for (const argument of node.typeArguments) {
        binder.walk.type(binder, argument, scope);
      }
      return;
    default:
      bindExpression(binder, node, scope);
  }
}

/** A struct literal's or an indented value's type and entries (§3.1, §2). */
function bindLiteral(binder: LocalBinder, node: FieldsLiteral | IndentedValue, scope: Scope): void {
  if (node.type !== undefined) {
    binder.constructedType(node.type, scope);
  }
  const items: readonly (IndentedEntry | FieldsLiteral['items'][number])[] =
    node.kind === 'IndentedValue' ? node.entries : node.items;
  binder.eachItem(items, scope, (item) => {
    if (item.kind === 'FieldInitializer') {
      // The shorthand `Pair{first}` reads the variable named like the field.
      bindFieldValue(binder, item.name, item.value, scope);
    } else if (item.kind === 'StructComprehension') {
      underFields(binder, item, scope, (variables) => {
        bindExpression(binder, item.key, variables);
        bindExpression(binder, item.value, variables);
      });
    } else {
      bindAll(binder, [item.kind === 'Spread' ? item : item.value], scope);
    }
  });
}

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
  Invalid: bindRejected,
  ArrayLiteral: (binder, node, scope) => bindAll(binder, node.elements, scope),
  MapLiteral: (binder, node, scope) =>
    binder.eachItem(node.entries, scope, (entry) =>
      bindAll(binder, entry.kind === 'MapEntry' ? [entry.key, entry.value] : [entry], scope),
    ),
  Tuple: (binder, node, scope) => bindAll(binder, node.elements, scope),
  Parenthesized: (binder, node, scope) => bindExpression(binder, node.expression, scope),
  Reference: (binder, node, scope) => bindExpression(binder, node.expression, scope),
  Propagate: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Unwrap: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  DeferredCall: (binder, node, scope) => {
    bindNamed(binder, node.taker, scope, 'callee');
    bindExpression(binder, node.call, scope);
  },
  ChainedComparison: (binder, node, scope) => bindAll(binder, node.operands, scope),
  TemplateLiteral: (binder, node, scope) => bindAll(binder, [node.tag, ...node.values], scope),
  Dereference: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Unary: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Await: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Index: (binder, node, scope) => bindAll(binder, [node.target, node.index], scope),
  Range: (binder, node, scope) => bindAll(binder, [node.start, node.end, node.step], scope),
  Call: (binder, node, scope) => {
    bindNamed(binder, node.callee, scope, 'callee');
    bindAll(binder, node.arguments, scope);
  },
  TypeApplication: (binder, node, scope) => bindNamed(binder, node, scope, 'value'),
  TupleElement: (binder, node, scope) => bindExpression(binder, node.target, scope),
  MemberAccess: (binder, node, scope) => {
    const path = qualifiedPath(node);
    if (path !== undefined) {
      binder.memberPath(path, scope);
    } else if (node.target.kind === 'Identifier') {
      binder.useBeforeMember(node.target, scope);
    } else {
      bindExpression(binder, node.target, scope);
    }
  },
  Binary: bindConditionValue,
  Is: bindConditionValue,
  StructLiteral: bindLiteral,
  NewStructLiteral: bindLiteral,
  IndentedValue: bindLiteral,
  Lambda: (binder, node, scope) => binder.walk.function(binder, node, scope),
  BlockExpression: (binder, node, scope) => binder.walk.block(binder, node.block, scope),
  Comprehension: (binder, node, scope) =>
    underLoop(binder, node, scope, (variables) =>
      underCondition(binder, node, variables, (flow) => bindExpression(binder, node.body, flow)),
    ),
  FieldComprehension: (binder, node, scope) =>
    underFields(binder, node, scope, (variables) => bindExpression(binder, node.body, variables)),
  If: (binder, node, scope) => {
    for (const branch of node.branches) {
      underCondition(binder, branch, scope, (flow) => binder.walk.block(binder, branch.body, flow));
    }
    if (node.elseClause !== undefined) {
      binder.walk.block(binder, node.elseClause.body, scope);
    }
  },
  Match: (binder, node, scope) => {
    bindExpression(binder, node.subject, scope);
    binder.eachItem(node.cases, scope, (matchCase) => {
      underBindings(binder, matchCase, scope, {
        define: (bindings) =>
          binder.walk.pattern(binder, matchCase.pattern, scope, { into: bindings }),
        body: (bindings) =>
          underCondition(binder, matchCase, bindings, (flow) =>
            binder.walk.block(binder, matchCase.body, flow),
          ),
      });
    });
  },
  Select: (binder, node, scope) => {
    binder.eachItem(node.cases, scope, (selectCase) => {
      bindExpression(binder, selectCase.future, scope);
      const name = selectCase.binding;
      const define = (bindings: Scope) => {
        if (name !== undefined) {
          binder.declareVariable(bindings, name, selectCase);
        }
      };
      underBindings(binder, selectCase, scope, {
        define,
        body: (bindings) => binder.walk.block(binder, selectCase.body, bindings),
      });
    });
    if (node.elseClause !== undefined) {
      binder.walk.block(binder, node.elseClause.body, scope);
    }
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

export function bindExpression(binder: LocalBinder, node: Expression, scope: Scope): void {
  binder.enter(node, scope);
  handlerOf(expressionHandlers, node)(binder, node, scope);
}

/**
 * Binds the value each of `nodes` gives: an expression's own, a spread's, or a named argument's.
 */
function bindAll(
  binder: LocalBinder,
  nodes: readonly (CallArgument | undefined)[],
  scope: Scope,
): void {
  for (const node of nodes) {
    if (node !== undefined) {
      bindExpression(binder, argumentValue(node), scope);
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
