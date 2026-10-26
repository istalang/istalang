/**
 * The one walk over a top-level constant's initializer (§3): it decides what compile time computes
 * and computes it, in the same switch, so the two can't disagree. Compile time computes literals, a
 * negated number among them, duration literals, tuples, structs in every literal form (a spread
 * copying a computed struct's fields), a struct without fields written bare, arrays and maps of
 * `Map`, lambdas, which capture nothing at the top level (§3.14), and other top-level constants;
 * anything else, a map literal of another type or a shared struct's `new` among them, is refused
 * where it stands.
 *
 * A spread spreads only an array or a map compile time built itself: its elements, or its entries
 * as tuples. Anything else iterable is iterated by `iterate` when the program runs, and computing
 * it here would be a second home for what the runtime's `iterate` does.
 *
 * A field a struct literal leaves to its default (§3.1) is computed by the same walk over the
 * default, in its declaration's module, read through the literal's type arguments, with the fields
 * before it as computed: it is computed when the default is, and refused where it isn't, as a
 * default calling a function is. A default reached again while it is being computed builds a value
 * needing itself, which would never be finished, so it is refused as endless.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { VariableOwner } from '../../binder/entities.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type {
  ArrayLiteral,
  Expression,
  Lambda,
  MapLiteral,
  Spread,
  StructLiteral,
} from '../../syntax/expressions.ts';
import type { Identifier, NodeOf } from '../../syntax/node.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import type { CheckedBody, CheckedConstant, FieldSource, FunctionCall } from '../check.ts';
import { type ConstantForm, durationForm, formSemantics } from '../constant-form.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { instantiatedBody } from '../types/instantiation.ts';
import { type Substitution, substitute, substitutionFor } from '../types/type.ts';

/**
 * What the walk reads: the checker's layouts and field defaults, the constant computed, its
 * initializer's checking, and the other constants. An annotation's value (§3.16) is computed the
 * same way, owned by no constant, so it can't hold a lambda, and so is a field's default.
 */
export interface ComputationScope {
  readonly checker: Pick<
    CheckerContext,
    'fieldsOf' | 'parametersOf' | 'defaultsOf' | 'moduleOf' | 'bindings' | 'constantNamed'
  >;
  readonly constant: VariableDeclaration | undefined;
  readonly checked: CheckedBody;
  /** The constant `name` denotes, or in a field's default, the field before it so named. */
  readonly valueNamed: (name: Identifier) => CheckedConstant | undefined;
}

/** How computing a part of an initializer went. */
export type Outcome =
  | { readonly kind: 'computed'; readonly form: ConstantForm }
  /**
   * Compile time doesn't compute `part`: it is no form compile time computes, or it needs a
   * default being computed, so it would never be finished.
   */
  | { readonly kind: 'refused'; readonly part: NodeOf<string>; readonly why: 'form' | 'endless' }
  /** An error a diagnostic already explained leaves no value. */
  | { readonly kind: 'unknown' };

const unknown: Outcome = { kind: 'unknown' };

/** What compile time makes of `initializer`. */
export function computeConstant(initializer: Expression, scope: ComputationScope): Outcome {
  return new Computation(scope, new Map(), new Map()).of(initializer);
}

/** Why compile time leaves `outcome` uncomputed, reported where its part stands. */
export function refusalOf(outcome: Extract<Outcome, { kind: 'refused' }>): Diagnostic {
  return outcome.why === 'endless'
    ? checkerDiagnostics.endlessDefault(outcome.part.span)
    : checkerDiagnostics.notConstant(outcome.part.span);
}

class Computation {
  readonly #scope: ComputationScope;
  /** The defaults being computed, by fields function and arity, which a cycle reaches again. */
  readonly #computing: Map<FunctionDeclaration, Set<number>>;
  /** What the scope's body is read through, which the calls it records, as checked, still need. */
  readonly #substitution: Substitution;

  constructor(
    scope: ComputationScope,
    computing: Map<FunctionDeclaration, Set<number>>,
    substitution: Substitution,
  ) {
    this.#scope = scope;
    this.#computing = computing;
    this.#substitution = substitution;
  }

  of(node: Expression): Outcome {
    switch (node.kind) {
      case 'IntegerLiteral':
      case 'FloatLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        return computed({ kind: 'primitive', value: node.value });
      case 'DurationLiteral': {
        const type = this.#scope.checked.typeOf(node);
        return type.kind === 'nominal' ? computed(durationForm(type, node.value)) : unknown;
      }
      case 'Parenthesized':
        return this.of(node.expression);
      case 'Unary':
        return node.operator === '-' && isNumberLiteral(node.operand)
          ? negated(this.of(node.operand))
          : refused(node);
      case 'Identifier': {
        const constant = this.#scope.valueNamed(node);
        if (constant === undefined) {
          return this.#bareStruct(node);
        }
        return constant.form === undefined ? unknown : computed(constant.form);
      }
      case 'StructLiteral':
        return this.#struct(node);
      case 'Tuple':
        return this.#tuple(node.elements);
      case 'ArrayLiteral':
        return this.#array(node);
      case 'MapLiteral':
        return this.#map(node);
      case 'Lambda':
        return this.#lambda(node);
      case 'Missing':
      case 'Invalid':
        return unknown;
      default:
        return refused(node);
    }
  }

  /** A lambda's function value, when it captures nothing: a closure of no captures. */
  #lambda(node: Lambda): Outcome {
    const checked = this.#scope.checked.functionOf(node);
    const { constant } = this.#scope;
    if (checked === undefined) {
      return unknown;
    }
    return checked.captures.length === 0 && constant !== undefined
      ? computed({ kind: 'function', lambda: node, constant })
      : refused(node);
  }

  /** A struct in any literal form, its fields in declaration order; never a cell `new` makes. */
  #struct(node: StructLiteral): Outcome {
    if (node.isNew) {
      return refused(node);
    }
    const type = this.#scope.checked.typeOf(node);
    const fields = this.#scope.checker.fieldsOf(type);
    if (fields === undefined || (type.kind !== 'nominal' && type.kind !== 'anonymous')) {
      return unknown;
    }
    if (node.items.some((item) => item.kind === 'Invalid')) {
      return unknown;
    }
    const sources = this.#scope.checked.sourcesOf(node);
    if (sources === undefined) {
      return unknown;
    }
    const forms: ConstantForm[] = [];
    for (const source of sources) {
      const part = this.#field(node, source, forms);
      if (part.kind !== 'computed') {
        return part;
      }
      forms.push(part.form);
    }
    return computed({ kind: 'struct', type, fields: forms });
  }

  /**
   * A field of the struct `literal`, from its `source`, after the fields `earlier`. A default it
   * refuses is refused at the literal, which runs it, where its declaration may be elsewhere.
   */
  #field(literal: StructLiteral, source: FieldSource, earlier: readonly ConstantForm[]): Outcome {
    switch (source.kind) {
      case 'value':
        return this.of(source.value);
      case 'spread':
        return this.#spreadField(source);
      case 'default': {
        const part = this.#default(source.call, earlier);
        return part.kind === 'refused' ? { ...part, part: literal } : part;
      }
      default: {
        const unhandled: never = source;
        return unhandled;
      }
    }
  }

  /** The default `call` gives a field, from the fields before it, `earlier`. */
  #default(call: FunctionCall, earlier: readonly ConstantForm[]): Outcome {
    const { checker } = this.#scope;
    const declaration = call.function;
    const parameters = checker.parametersOf(declaration);
    const value = parameters[call.arity]?.node.defaultValue;
    const checked = checker.defaultsOf(declaration);
    if (value === undefined || checked === undefined) {
      return unknown;
    }
    const computing = this.#computing.get(declaration) ?? new Set<number>();
    if (computing.has(call.arity)) {
      return { kind: 'refused', part: value, why: 'endless' };
    }
    computing.add(call.arity);
    this.#computing.set(declaration, computing);
    const outcome = this.#defaultValue(call, value, checked, earlier);
    computing.delete(call.arity);
    return outcome;
  }

  /** The default `value` of `call`'s field, checked as `checked`, from the fields `earlier`. */
  #defaultValue(
    call: FunctionCall,
    value: Expression,
    checked: CheckedBody,
    earlier: readonly ConstantForm[],
  ): Outcome {
    const { checker } = this.#scope;
    const declaration = call.function;
    const parameters = checker.parametersOf(declaration);
    const module = checker.moduleOf(declaration);
    const typeArguments = call.typeArguments.map((type) => substitute(type, this.#substitution));
    const substitution = substitutionFor(declaration.typeParameters, typeArguments);
    const fields = new Map<VariableOwner, CheckedConstant>(
      parameters
        .slice(0, call.arity)
        .map((parameter, index) => [
          parameter.node,
          { type: substitute(parameter.type, substitution), form: earlier[index] },
        ]),
    );
    const scope: ComputationScope = {
      checker,
      constant: undefined,
      checked: instantiatedBody(checked, substitution),
      valueNamed: (name) => {
        const entity = checker.bindings.entityOf(module, name);
        const field = entity?.kind === 'variable' ? fields.get(entity.owner) : undefined;
        return field ?? checker.constantNamed(module, name);
      },
    };
    return new Computation(scope, this.#computing, substitution).of(value);
  }

  /** The field at `index` of a spread value, which must itself compute to a struct. */
  #spreadField(source: { readonly from: Expression; readonly index: number }): Outcome {
    const whole = this.of(source.from);
    if (whole.kind !== 'computed') {
      return whole;
    }
    const field = whole.form.kind === 'struct' ? whole.form.fields[source.index] : undefined;
    return field === undefined ? unknown : computed(field);
  }

  #tuple(elements: readonly Expression[]): Outcome {
    if (elements.length === 0) {
      return computed({ kind: 'primitive', value: null });
    }
    const forms: ConstantForm[] = [];
    for (const element of elements) {
      const part = this.of(element);
      if (part.kind !== 'computed') {
        return part;
      }
      forms.push(part.form);
    }
    return computed({ kind: 'tuple', elements: forms });
  }

  /** An array of its elements and spreads' items; `[]` where a `Map` is expected is an empty map. */
  #array(node: ArrayLiteral): Outcome {
    const form = this.#scope.checked.collectionFormOf(node);
    if (form !== 'array') {
      return form === 'map' ? computed({ kind: 'map', entries: [] }) : refused(node);
    }
    const elements: ConstantForm[] = [];
    for (const element of node.elements) {
      const part = element.kind === 'Spread' ? this.#items(element) : this.of(element);
      if (part.kind !== 'computed') {
        return part;
      }
      elements.push(...(element.kind === 'Spread' ? itemsOf(part.form) : [part.form]));
    }
    return computed({ kind: 'array', elements });
  }

  /** A map of its entries in order, a later equal key replacing the value (§2). */
  #map(node: MapLiteral): Outcome {
    if (this.#scope.checked.collectionFormOf(node) !== 'map') {
      return refused(node);
    }
    const pairs: (readonly [ConstantForm, ConstantForm])[] = [];
    for (const entry of node.entries) {
      const part = this.#entry(entry);
      if (part.kind !== 'computed') {
        return part;
      }
      pairs.push(...itemsOf(part.form).flatMap(pairOf));
    }
    return computed(formSemantics.mapOf(pairs));
  }

  /** What one entry of a map literal adds: something whose items are `(key, value)` tuples. */
  #entry(entry: MapLiteral['entries'][number]): Outcome {
    if (entry.kind === 'Invalid') {
      return unknown;
    }
    if (entry.kind === 'Spread') {
      return this.#items(entry);
    }
    const pair = this.#tuple([entry.key, entry.value]);
    return pair.kind === 'computed' ? computed({ kind: 'array', elements: [pair.form] }) : pair;
  }

  /** What a spread spreads: a computed array or map, its items read with `itemsOf`. */
  #items(spread: Spread): Outcome {
    const spreading = this.of(spread.expression);
    if (spreading.kind !== 'computed') {
      return spreading;
    }
    return spreading.form.kind === 'array' || spreading.form.kind === 'map'
      ? spreading
      : refused(spread);
  }

  /** A struct without fields named bare (§3.1); any other name that isn't a constant is refused. */
  #bareStruct(node: Identifier): Outcome {
    const type = this.#scope.checked.typeOf(node);
    return type.kind === 'nominal' && this.#scope.checker.fieldsOf(type)?.length === 0
      ? computed({ kind: 'struct', type, fields: [] })
      : refused(node);
  }
}

/** The items a spread of `form`, an array or a map, gives: its elements, or its entries as tuples. */
function itemsOf(form: ConstantForm): readonly ConstantForm[] {
  switch (form.kind) {
    case 'array':
      return form.elements;
    case 'map':
      return form.entries.map(([key, value]) => ({ kind: 'tuple', elements: [key, value] }));
    default:
      return [];
  }
}

/** The key and value of a `(key, value)` tuple, a map literal's item. */
function pairOf(item: ConstantForm): (readonly [ConstantForm, ConstantForm])[] {
  const [key, value] = item.kind === 'tuple' ? item.elements : [];
  return key === undefined || value === undefined ? [] : [[key, value]];
}

function computed(form: ConstantForm): Outcome {
  return { kind: 'computed', form };
}

function refused(part: NodeOf<string>): Outcome {
  return { kind: 'refused', part, why: 'form' };
}

/** A number literal, possibly parenthesized: what compile time negates. */
function isNumberLiteral(node: Expression): boolean {
  if (node.kind === 'Parenthesized') {
    return isNumberLiteral(node.expression);
  }
  return node.kind === 'IntegerLiteral' || node.kind === 'FloatLiteral';
}

function negated(operand: Outcome): Outcome {
  if (operand.kind !== 'computed') {
    return operand;
  }
  const { value } = operand.form.kind === 'primitive' ? operand.form : { value: undefined };
  return typeof value === 'bigint' || typeof value === 'number'
    ? computed({ kind: 'primitive', value: -value })
    : unknown;
}
