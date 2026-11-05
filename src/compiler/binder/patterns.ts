/**
 * Binding names in patterns (§3.11) and in the targets of declarations and loops (§3.15).
 *
 * A pattern both refers and binds. The names it refers to (variants, types, the values a field is
 * compared with) resolve in the scope the pattern is written in. The variables it binds go into a
 * fresh scope that the case's guard and body, or the condition's flow, see. Keeping the two scopes
 * apart is what stops a pattern from seeing its own bindings.
 *
 * In a `match` case, a bare name binds a new variable when it is camelCase and refers to a variant
 * or a type when it is PascalCase (naming.ts), and each binding is owned by the
 * pattern node that binds it. A declaration's or loop's target only binds, so there a bare name
 * always binds (naming.ts then reports a PascalCase one), and every binding is owned by the
 * declaration, which says whether it is a `let` or a `const`. A qualified name always refers.
 */

import { bindsInPattern } from '../../language/naming.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import type { Identifier } from '../syntax/node.ts';
import type { Pattern, RestPattern } from '../syntax/patterns.ts';
import type { VariableEntity, VariableOwner } from './entities.ts';
import { holdsNoNames, type LocalBinder, type PatternBindings } from './local-binder.ts';
import { Scope } from './scope.ts';

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
    for (const argument of node.typeArguments) {
      binder.walk.type(binder, argument, binding.scope);
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
  OrPattern: (binder, node, binding) => bindAlternatives(binder, node.alternatives, binding),
  ArrayPattern: (binder, node, binding) => {
    for (const element of node.elements) {
      if (element.kind === 'RestPattern') {
        defineRest(binder, element, binding);
      } else {
        walk(binder, element, binding);
      }
    }
  },
  RangePattern: holdsNoNames,
  StructPattern: (binder, node, binding) => {
    if (node.type !== undefined) {
      binder.constructedType(node.type, binding.scope);
    }
    for (const field of node.fields) {
      handlerOf(fieldPatternHandlers, field)(binder, field, binding);
    }
    if (node.rest !== undefined) {
      defineRest(binder, node.rest, binding);
    }
  },
};

/** `...name` binds `name`; `..._` nothing. */
function defineRest(binder: LocalBinder, rest: RestPattern, binding: Binding): void {
  if (rest.target.kind === 'Identifier') {
    define(binder, binding.bindings, rest.target, rest);
  }
}

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
  binder.enter(node, binding.scope);
  handlerOf(patternHandlers, node)(binder, node, binding);
}

/**
 * The alternatives of `A | B`, each binding into a scope of its own. The first's names are then
 * defined where the pattern binds, and a later one's name is the first's variable of that name, so
 * whichever alternative matched, the body reads one variable. A name only a later alternative
 * binds is defined too, so it resolves where it is read; the checker reports that the
 * alternatives differ (§3.11).
 */
function bindAlternatives(
  binder: LocalBinder,
  alternatives: readonly Pattern[],
  binding: Binding,
): void {
  const { into } = binding.bindings;
  if (into === undefined) {
    for (const alternative of alternatives) {
      walk(binder, alternative, binding);
    }
    return;
  }
  const first = new Map<string, VariableEntity>();
  for (const alternative of alternatives) {
    const own = Scope.nested(into);
    walk(binder, alternative, { ...binding, bindings: { ...binding.bindings, into: own } });
    const variables = own.definedSince(into).flatMap((name) => {
      const entity = own.lookup(name);
      return entity?.kind === 'variable' ? [entity] : [];
    });
    for (const variable of variables) {
      adopt(binder, into, first, variable);
    }
  }
}

/**
 * Makes an alternative's `variable` the first alternative's of its name, or, binding a name no
 * earlier alternative did, defines it in `into`.
 */
function adopt(
  binder: LocalBinder,
  into: Scope,
  first: Map<string, VariableEntity>,
  variable: VariableEntity,
): void {
  const earlier = first.get(variable.name.text);
  if (earlier !== undefined) {
    binder.record(variable.name, earlier);
  } else if (binder.declare(into, variable.name, variable)) {
    first.set(variable.name.text, variable);
  }
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
