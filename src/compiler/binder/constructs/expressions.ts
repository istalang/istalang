/**
 * Binding names in expressions (§2–§4, §3.11, §3.14). Where the bindings of a condition, case or
 * comprehension are visible is module/flow.ts's rule.
 *
 * `a.b.c` is bound as a qualified name only when its head may be a module namespace or an enum:
 * otherwise every part after the head is a member, which the checker resolves by type. A head
 * naming a function denotes its call instead (§7, module/local-binder.ts `useBeforeMember`).
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import { argumentValue } from '../../syntax/expressions/arguments.ts';
import type {
  CallArgument,
  Expression,
  FieldsLiteral,
  IndentedValue,
  MatchCase,
  SelectCase,
} from '../../syntax/expressions/index.ts';
import { casesOf, qualifiedPath, selectCasesOf } from '../../syntax/expressions/readings.ts';
import type { Identifier, Invalid } from '../../syntax/node.ts';
import {
  bindConditionValue,
  underBindings,
  underCondition,
  underFields,
  underLoop,
} from '../module/flow.ts';
import { holdsNoNames, type LocalBinder } from '../module/local-binder.ts';
import type { Scope } from '../module/scope.ts';

/** A struct literal's or an indented value's type and entries (§3.1, §2). */
function bindLiteral(binder: LocalBinder, node: FieldsLiteral | IndentedValue, scope: Scope): void {
  if (node.type !== undefined) {
    binder.constructedType(node.type, scope);
  }
  for (const item of node.kind === 'IndentedValue' ? node.entries : node.items) {
    if (item.kind === 'FieldInitializer') {
      // The shorthand `Pair{first}` reads the variable named like the field.
      bindFieldValue(binder, item.name, item.value, scope);
    } else if (item.kind === 'StructComprehension') {
      underFields(binder, item, scope, (variables) => {
        bindExpression(binder, item.key, variables);
        bindExpression(binder, item.value, variables);
      });
    } else if (item.kind !== 'Invalid') {
      bindAll(binder, [item.kind === 'Spread' ? item : item.value], scope);
    }
  }
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
  Spawn: (binder, node, scope) => bindExpression(binder, node.call, scope),
  ChainedComparison: (binder, node, scope) => bindAll(binder, node.operands, scope),
  TemplateLiteral: (binder, node, scope) => bindAll(binder, [node.tag, ...node.values], scope),
  Dereference: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Unary: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Await: (binder, node, scope) => bindExpression(binder, node.operand, scope),
  Index: (binder, node, scope) => bindAll(binder, [node.target, node.index], scope),
  Range: (binder, node, scope) => bindAll(binder, [node.start, node.end, node.step], scope),
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
    bindRejectedAnnotations(binder, node.cases, scope);
    for (const matchCase of casesOf(node)) {
      underBindings(binder, matchCase, scope, {
        define: (bindings) =>
          binder.walk.pattern(binder, matchCase.pattern, scope, { into: bindings }),
        body: (bindings) =>
          underCondition(binder, matchCase, bindings, (flow) =>
            binder.walk.block(binder, matchCase.body, flow),
          ),
      });
    }
  },
  Select: (binder, node, scope) => {
    bindRejectedAnnotations(binder, node.cases, scope);
    for (const selectCase of selectCasesOf(node)) {
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
    }
    if (node.elseClause !== undefined) {
      binder.walk.block(binder, node.elseClause.body, scope);
    }
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * Binds the annotations held by the Invalid items among a body's cases, where the parser takes
 * none (§3.16): their values are still struct values written in the body's scope.
 */
function bindRejectedAnnotations(
  binder: LocalBinder,
  items: readonly (MatchCase | SelectCase | Invalid)[],
  scope: Scope,
): void {
  for (const item of items) {
    if (item.kind === 'Invalid') {
      binder.annotations(item, scope);
    }
  }
}

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
