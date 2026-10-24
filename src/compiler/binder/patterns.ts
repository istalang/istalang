/**
 * Binding names in patterns (§3.11).
 *
 * A pattern both refers and binds. The names it refers to (variants, types, the values a field is
 * compared with) resolve in the scope the pattern is written in. The variables it binds go into a
 * fresh scope that the case's guard and body, or the condition's flow, see. Keeping the two scopes
 * apart is what stops a pattern from seeing its own bindings.
 *
 * A bare name binds a new variable when it is camelCase and refers to a variant or constant when it
 * is PascalCase (naming.ts). A qualified name always refers.
 */

import { type Handlers, handlerOf } from '../syntax/handlers.ts';
import type { Pattern } from '../syntax/patterns.ts';
import { holdsNoNames, type LocalBinder } from './local-binder.ts';
import { bindsInPattern } from './naming.ts';
import type { Scope } from './scope.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const patternHandlers: Handlers<LocalBinder, Pattern, [Scope, Scope], void> = {
  WildcardPattern: holdsNoNames,
  LiteralPattern: holdsNoNames,
  Missing: holdsNoNames,
  Invalid: holdsNoNames,
  NamePattern: (binder, node, scope, into) => {
    const [name, ...rest] = node.path;
    if (rest.length === 0 && bindsInPattern(name.text)) {
      binder.declareVariable(into, name, node);
    } else {
      binder.path(node.path, scope, 'value');
    }
  },
  TuplePattern: (binder, node, scope, into) => {
    for (const element of node.elements) {
      bindPattern(binder, element, scope, into);
    }
  },
  ParenthesizedPattern: (binder, node, scope, into) =>
    bindPattern(binder, node.pattern, scope, into),
  AsPattern: (binder, node, scope, into) => {
    bindPattern(binder, node.pattern, scope, into);
    binder.declareVariable(into, node.name, node);
  },
  StructPattern: (binder, node, scope, into) => {
    if (node.type !== undefined) {
      binder.constructedType(node.type, scope);
    }
    for (const field of node.fields) {
      bindFieldPattern(binder, field, scope, into);
    }
  },
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

export function bindPattern(binder: LocalBinder, node: Pattern, scope: Scope, into: Scope): void {
  handlerOf(patternHandlers, node)(binder, node, scope, into);
}

type FieldPattern = Extract<Pattern, { kind: 'StructPattern' }>['fields'][number];

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
/** One item in a struct pattern's braces; its field name is the checker's to resolve. */
const fieldPatternHandlers: Handlers<LocalBinder, FieldPattern, [Scope, Scope], void> = {
  BindFieldPattern: (binder, field, _scope, into) => {
    const name = field.alias ?? field.field;
    binder.declareVariable(into, name, field);
  },
  CompareFieldPattern: (binder, field, scope) => binder.walk.expression(binder, field.value, scope),
  NestedFieldPattern: (binder, field, scope, into) =>
    bindPattern(binder, field.pattern, scope, into),
  Invalid: holdsNoNames,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

function bindFieldPattern(
  binder: LocalBinder,
  field: FieldPattern,
  scope: Scope,
  into: Scope,
): void {
  handlerOf(fieldPatternHandlers, field)(binder, field, scope, into);
}
