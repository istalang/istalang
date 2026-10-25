/**
 * Binding names in patterns (§3.11) and in the targets of declarations and loops (§3.15).
 *
 * A pattern both refers and binds. The names it refers to (variants, types, the values a field is
 * compared with) resolve in the scope the pattern is written in. The variables it binds go into a
 * fresh scope that the case's guard and body, or the condition's flow, see. Keeping the two scopes
 * apart is what stops a pattern from seeing its own bindings.
 *
 * In a `match` case, a bare name binds a new variable when it is camelCase and refers to a variant
 * or a struct without fields when it is PascalCase (naming.ts), and each binding is owned by the
 * pattern node that binds it. A declaration's or loop's target only binds, so there a bare name
 * always binds (naming.ts then reports a PascalCase one), and every binding is owned by the
 * declaration, which says whether it is a `let` or a `const`. A qualified name always refers.
 */

import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import type { Identifier } from '../syntax/node.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type { VariableOwner } from './entities.ts';
import { holdsNoNames, type LocalBinder, type PatternBindings } from './local-binder.ts';
import { bindsInPattern } from './naming.ts';
import type { Scope } from './scope.ts';

interface Binding {
  readonly scope: Scope;
  readonly bindings: PatternBindings;
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const patternHandlers: Handlers<LocalBinder, Pattern, [Binding], void> = {
  WildcardPattern: holdsNoNames,
  LiteralPattern: holdsNoNames,
  Missing: holdsNoNames,
  Invalid: holdsNoNames,
  NamePattern: (binder, node, binding) => {
    const [name, ...rest] = node.path;
    const binds =
      rest.length === 0 &&
      (binding.bindings.declaration !== undefined || bindsInPattern(name.text));
    if (binds) {
      define(binder, binding.bindings, name, node);
    } else {
      binder.path(node.path, binding.scope, 'value');
    }
  },
  TuplePattern: (binder, node, binding) => {
    for (const element of node.elements) {
      walk(binder, element, binding);
    }
  },
  ParenthesizedPattern: (binder, node, binding) => walk(binder, node.pattern, binding),
  AsPattern: (binder, node, binding) => {
    walk(binder, node.pattern, binding);
    define(binder, binding.bindings, node.name, node);
  },
  StructPattern: (binder, node, binding) => {
    if (node.type !== undefined) {
      binder.constructedType(node.type, binding.scope);
    }
    for (const field of node.fields) {
      handlerOf(fieldPatternHandlers, field)(binder, field, binding);
    }
  },
};

type FieldPattern = Extract<Pattern, { kind: 'StructPattern' }>['fields'][number];

/** One item in a struct pattern's braces; its field name is the checker's to resolve. */
const fieldPatternHandlers: Handlers<LocalBinder, FieldPattern, [Binding], void> = {
  BindFieldPattern: (binder, field, binding) =>
    define(binder, binding.bindings, field.alias ?? field.field, field),
  CompareFieldPattern: (binder, field, binding) =>
    binder.walk.expression(binder, field.value, binding.scope),
  NestedFieldPattern: (binder, field, binding) => walk(binder, field.pattern, binding),
  Invalid: holdsNoNames,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** Resolves the pattern's references in `scope` and defines its bindings where `bindings` says. */
export function bindPattern(
  binder: LocalBinder,
  node: Pattern,
  scope: Scope,
  bindings: PatternBindings,
): void {
  walk(binder, node, { scope, bindings });
}

function walk(binder: LocalBinder, node: Pattern, binding: Binding): void {
  handlerOf(patternHandlers, node)(binder, node, binding);
}

/** Defines `name`, owned by the declaration of a target or else by the pattern node binding it. */
function define(
  binder: LocalBinder,
  bindings: PatternBindings,
  name: Identifier,
  node: VariableOwner,
): void {
  if (bindings.into !== undefined) {
    binder.declareVariable(bindings.into, name, bindings.declaration ?? node);
  }
}
