/**
 * What one instantiation does to each part a checked body records (§3.5): a body is checked once,
 * generically, so what runs for one instantiation reads it with every type it records substituted.
 * The body's facts table (index.ts) says which part each fact is made of; the parts are
 * substituted here. The calls a body records stay as checked: closing one takes the
 * instantiation's witnesses too, which its reader has, so the reader closes it
 * (lowering/closed-calls.ts `closeCall`, rules/computation.ts for a default's). Lowering reads a
 * function instance's body this way, and compile time a field's default for the literal running it.
 */

import { memo } from '../../../structures/memo.ts';
import type {
  AssignedPart,
  ChainLink,
  CheckedFunction,
  Checker,
  FieldPass,
  IterationForm,
} from '../check.ts';
import {
  type FieldRead,
  keyedFieldRead,
  namedFieldRead,
  requiredFieldRead,
} from '../surface/checked-field.ts';
import type {
  CheckedPattern,
  PartStep,
  PatternTest,
  StructStep,
  TargetBinding,
  TargetStep,
} from '../surface/checked-pattern.ts';
import { unfolded } from '../types/computed-types.ts';
import type { Fit } from '../types/fit.ts';
import { sameType } from '../types/identity.ts';
import {
  type Substitution,
  substitute,
  substituteAny,
  substituteKept,
} from '../types/substitution.ts';
import type { FieldMember, Type } from '../types/type.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { membersOf } from '../types/unions.ts';

/** One instantiation: each kind of part a body records, as it reads it. */
export interface Instantiation {
  readonly substitution: Substitution;
  readonly checker: Pick<Checker, 'fieldsOf' | 'typeRules'>;
  /** A type as substituted, a recursive one unfolded (§3.17): what an expression is read as. */
  readonly concrete: (type: Type) => Type;
  readonly fit: (fit: Fit) => Fit;
  readonly field: (field: FieldMember) => FieldMember;
  readonly fieldRead: (read: FieldRead) => FieldRead;
  readonly target: (binding: TargetBinding) => TargetBinding;
  readonly assigned: (part: AssignedPart) => AssignedPart;
  readonly function: (checked: CheckedFunction) => CheckedFunction;
  readonly pattern: (checked: CheckedPattern) => CheckedPattern;
  readonly iteration: (form: IterationForm) => IterationForm;
  readonly chain: (link: ChainLink) => ChainLink;
  /** A field loop's pass: its key and value substituted, and its body read the same way. */
  readonly pass: (pass: FieldPass) => FieldPass;
}

/** The instantiation `substitution` makes, for reading a body checked once (§3.5). */
export function instantiationBy(
  substitution: Substitution,
  checker: Pick<Checker, 'fieldsOf' | 'typeRules'>,
): Instantiation {
  const rules = checker.typeRules;
  // A body reads one type at many nodes, and lowering reads each node's again and again.
  const concreteTypes = new WeakMap<Type, Type>();
  const concrete = (type: Type) =>
    memo(concreteTypes, type, () => unfolded(substitute(type, substitution, rules)));
  return {
    substitution,
    checker,
    concrete,
    fit: (fit) => substitutedFit(fit, substitution, rules),
    field: (field) => ({ ...field, type: concrete(field.type) }),
    fieldRead: (read) => instantiatedRead(checker, read, concrete),
    target: (binding) => instantiatedTarget(binding, substitution, rules),
    assigned: (part) => instantiatedPart(part, substitution, rules),
    function: (checked) => instantiatedFunction(checked, substitution, rules),
    pattern: (checked) => instantiatedPattern(checked, substitution, rules),
    iteration: (form) => (form.kind === 'cursor' ? { ...form, item: concrete(form.item) } : form),
    chain: (link) => ({ base: concrete(link.base), carried: concrete(link.carried) }),
    pass: ({ visits, key, value, body }) => ({
      visits,
      key: substitute(key, substitution, rules),
      value: substitute(value, substitution, rules),
      body: body.instantiated(substitution, checker),
    }),
  };
}

/** A part an assignment writes, its path, type and fit substituted. */
function instantiatedPart(
  part: AssignedPart,
  substitution: Substitution,
  rules: TypeRules,
): AssignedPart {
  return {
    ...part,
    path: instantiatedTargetPath(part.path, substitution, rules),
    type: substitute(part.type, substitution, rules),
    fit: part.fit === 'intoKeyedField' ? part.fit : substitutedFit(part.fit, substitution, rules),
  };
}

/** A lambda or local function of the body with every type it records substituted. */
function instantiatedFunction(
  checked: CheckedFunction,
  substitution: Substitution,
  rules: TypeRules,
): CheckedFunction {
  const concrete = (type: Type) => substitute(type, substitution, rules);
  return {
    type: substituteKept(checked.type, substitution, rules),
    parameters: checked.parameters.map((parameter) => ({
      ...parameter,
      type: concrete(parameter.type),
    })),
    captures: checked.captures.map((captured) => ({ ...captured, type: concrete(captured.type) })),
  };
}

/** What a target binds, as one instantiation sees it: its type and its path's types substituted. */
function instantiatedTarget(
  binding: TargetBinding,
  substitution: Substitution,
  rules: TypeRules,
): TargetBinding {
  return {
    ...binding,
    type: substitute(binding.type, substitution, rules),
    path: instantiatedTargetPath(binding.path, substitution, rules),
  };
}

/** A target's or an assignment's path as one instantiation sees it: its struct steps' types substituted. */
function instantiatedTargetPath(
  path: readonly TargetStep[],
  substitution: Substitution,
  rules: TypeRules,
): readonly TargetStep[] {
  return path.map((step) =>
    typeof step === 'number' ? step : instantiatedStructStep(step, substitution, rules),
  );
}

/**
 * `checked` with every type it records substituted, in its or-patterns' alternatives too. Each test
 * and step kind is listed, so a kind that comes to carry a type can't pass through unsubstituted.
 *
 * A union a member test tests may collapse (§3.5): `T | Int` with `T = Int` is `Int`. Its value is
 * then the member's own value, with no variant around it: the `member` step into it carries the
 * union, substituted here, so whoever reads the path sees the collapse, and a name narrowed from
 * it reads the value as it is.
 */
function instantiatedPattern(
  checked: CheckedPattern,
  substitution: Substitution,
  rules: TypeRules,
): CheckedPattern {
  const concrete = (type: Type) => substitute(type, substitution, rules);
  const path = (steps: readonly PartStep[]) =>
    steps.map((step) => instantiatedStep(step, substitution, rules));
  const instantiatedTest = (patternTest: PatternTest): PatternTest => {
    switch (patternTest.kind) {
      case 'downcast':
        return {
          ...patternTest,
          path: path(patternTest.path),
          from: substituteAny(patternTest.from, substitution, rules),
          to: concrete(patternTest.to),
        };
      case 'member':
        return {
          ...patternTest,
          path: path(patternTest.path),
          union: unfolded(concrete(patternTest.union)),
          members: patternTest.members.flatMap((member) => membersOf(concrete(member))),
        };
      case 'or':
        return {
          ...patternTest,
          alternatives: patternTest.alternatives.map((each) =>
            instantiatedPattern(each, substitution, rules),
          ),
        };
      case 'variant':
      case 'equal':
      case 'compare':
        return { ...patternTest, path: path(patternTest.path) };
      case 'never':
        return patternTest;
      default: {
        const unhandled: never = patternTest;
        return unhandled;
      }
    }
  };
  return {
    tests: checked.tests.map(instantiatedTest),
    bindings: checked.bindings.map(({ narrowedFrom, ...binding }) => {
      const type = concrete(binding.type);
      const from = narrowedFrom === undefined ? undefined : concrete(narrowedFrom);
      return {
        ...binding,
        path: path(binding.path),
        type,
        narrowedFrom: from === undefined || sameType(from, type) ? undefined : from,
      };
    }),
  };
}

/** `step` with the type it carries substituted. */
function instantiatedStep(step: PartStep, substitution: Substitution, rules: TypeRules): PartStep {
  if (typeof step === 'number') {
    return step;
  }
  switch (step.kind) {
    case 'member':
      return {
        kind: 'member',
        union: unfolded(substitute(step.union, substitution, rules)),
        member: substitute(step.member, substitution, rules),
      };
    case 'field':
    case 'fieldRest':
      return instantiatedStructStep(step, substitution, rules);
    case 'downcast':
    case 'length':
    case 'item':
    case 'rest':
      return step;
    default: {
      const unhandled: never = step;
      return unhandled;
    }
  }
}

/** A struct step with the types it carries substituted: an instantiation decides what they are. */
function instantiatedStructStep(
  step: StructStep,
  substitution: Substitution,
  rules: TypeRules,
): StructStep {
  const concrete = (type: Type) => substitute(type, substitution, rules);
  return step.kind === 'field'
    ? { ...step, of: concrete(step.of) }
    : { kind: 'fieldRest', from: concrete(step.from), to: concrete(step.to) };
}

/**
 * `fit` as one instantiation makes it: the type a conversion converts into, substituted. A union
 * the value goes into may collapse into one type (§3.5): a value that went in as a member then is
 * a value of that type already, its own or a literal of it, which is its base's value; one that
 * went in member by member was a union of that type's literals, or that type, taken as its base.
 * A union collapsing into an `any` type took the value's type whole (§2), so the value still goes
 * into it, as lowering derives.
 */
function substitutedFit(
  { conversion, into }: Fit,
  substitution: Substitution,
  rules: TypeRules,
): Fit {
  const substituted = substitutedConversion(conversion, substitution, rules);
  if (into === undefined) {
    return { conversion: substituted };
  }
  // A recursive union substituted is its use again (§3.17); the value goes into what it unfolds to.
  const union = unfolded(substitute(into.union, substitution, rules));
  const member =
    into.member === undefined ? undefined : substitute(into.member, substitution, rules);
  if (union.kind === 'union' || union.kind === 'any') {
    return { conversion: substituted, into: { union, member } };
  }
  return { conversion: member === undefined ? { kind: 'base' } : substituted };
}

function substitutedConversion(
  conversion: Fit['conversion'],
  substitution: Substitution,
  rules: TypeRules,
) {
  switch (conversion.kind) {
    case 'any':
      return { kind: 'any', to: substituteAny(conversion.to, substitution, rules) } as const;
    case 'shape':
      return { kind: 'shape', to: substituteKept(conversion.to, substitution, rules) } as const;
    default:
      return conversion;
  }
}

/** `read` as an instantiation reaches it, each type it reads through made `concrete`. */
function instantiatedRead(
  checker: Pick<Checker, 'fieldsOf'>,
  read: FieldRead,
  concrete: (type: Type) => Type,
): FieldRead {
  switch (read.kind) {
    case 'position':
      return read;
    case 'dispatch':
    case 'required':
      return requiredFieldRead(checker, concrete(read.on), read.required);
    case 'named':
      return namedFieldRead(checker, concrete(read.on), read.name);
    case 'keyed':
      return keyedFieldRead(checker, concrete(read.on), concrete(read.key));
    default: {
      const unhandled: never = read;
      return unhandled;
    }
  }
}
