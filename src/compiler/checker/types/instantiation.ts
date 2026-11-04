/**
 * A checked body read through a substitution (§3.5): a body is checked once, generically, so what
 * runs for one instantiation reads it with every type it records substituted. The calls it records
 * stay as checked: closing one takes the instantiation's witnesses too, which its reader has, so
 * the reader closes it (lowering/instances.ts `closeCall`, rules/computation.ts for a default's).
 * Lowering reads a function instance's body this way, and compile time a field's default for the
 * literal running it.
 */

import type { CheckedBody, Checker } from '../check.ts';
import { type FieldRead, requiredFieldRead } from '../checked-field.ts';
import type { CheckedPattern, PartStep, PatternTest } from '../checked-pattern.ts';
import type { Fit } from './fit.ts';
import { sameType } from './identity.ts';
import { type Substitution, substitute, substituteAny, substituteKept } from './substitution.ts';
import type { FieldMember, Type } from './type.ts';
import { membersOf } from './unions.ts';

/**
 * `body` as one instantiation sees it: every type it records substituted by `substitution`, and
 * each field read through a type parameter resolved for the type it stands for. Every table is
 * listed, substituted or kept as checked, so a table added to CheckedBody fails to typecheck here
 * until it says how an instantiation reads it.
 */
export function instantiatedBody(
  body: CheckedBody,
  substitution: Substitution,
  checker: Pick<Checker, 'fieldsOf'>,
): CheckedBody {
  const concrete = (type: Type) => substitute(type, substitution);
  const concreteFit = (fit: Fit) => substitutedFit(fit, substitution);
  const concreteField = (field: FieldMember) => ({ ...field, type: concrete(field.type) });
  const concreteRead = (read: FieldRead): FieldRead =>
    read.kind === 'position' ? read : requiredFieldRead(checker, concrete(read.on), read.required);
  return {
    typeOf: (expression) => mapDefined(body.typeOf(expression), concrete),
    expectedOf: (site) => mapDefined(body.expectedOf(site), concrete),
    resolved: body.resolved,
    valueCalls: body.valueCalls,
    madeCalls: body.madeCalls,
    implicitCallOf: body.implicitCallOf,
    collectionFormOf: body.collectionFormOf,
    iterationOf: (iteration) => {
      const form = body.iterationOf(iteration);
      return form.kind === 'cursor' ? { ...form, item: concrete(form.item) } : form;
    },
    fitAt: (site) => concreteFit(body.fitAt(site)),
    targetsOf: (owner) =>
      body.targetsOf(owner).map((binding) => ({ ...binding, type: concrete(binding.type) })),
    assignedOf: (assignment) =>
      body
        .assignedOf(assignment)
        .map((part) => ({ ...part, type: concrete(part.type), fit: concreteFit(part.fit) })),
    inCell: body.inCell,
    functionOf: (node) =>
      mapDefined(body.functionOf(node), (checked) => ({
        type: substituteKept(checked.type, substitution),
        parameters: checked.parameters.map((parameter) => ({
          ...parameter,
          type: concrete(parameter.type),
        })),
        captures: checked.captures.map((captured) => ({
          ...captured,
          type: concrete(captured.type),
        })),
      })),
    sourcesOf: body.sourcesOf,
    literalFieldsOf: (literal) =>
      mapDefined(body.literalFieldsOf(literal), (fields) => fields.map(concreteField)),
    patternOf: (pattern) =>
      mapDefined(body.patternOf(pattern), (checked) => instantiatedPattern(checked, substitution)),
    chainOf: (link) =>
      mapDefined(body.chainOf(link), (chained) => ({
        base: concrete(chained.base),
        carried: concrete(chained.carried),
      })),
    fieldReadOf: (access) => mapDefined(body.fieldReadOf(access), concreteRead),
    declaredTypeOf: (name) => mapDefined(body.declaredTypeOf(name), concrete),
    namedFieldOf: (name) => mapDefined(body.namedFieldOf(name), concreteField),
    chosenVariantOf: body.chosenVariantOf,
    candidatesAt: body.candidatesAt,
    labels: body.labels,
    result: concrete(body.result),
  };
}

/** `f(value)`, or undefined for an undefined value: a table's answer, read through `f`. */
function mapDefined<T, R>(value: T | undefined, f: (defined: T) => R): R | undefined {
  return value === undefined ? undefined : f(value);
}

/**
 * `checked` with every type it records substituted, in its or-patterns' alternatives too. Each test
 * kind is listed, so a kind that comes to carry a type can't pass through unsubstituted.
 *
 * A union a member test tests may collapse (§3.5): `T | Int` with `T = Int` is `Int`. Its value is
 * then the member's own value, with no variant around it, so every path into the member's value
 * at the test's part loses the step into the variant (`collapsedSteps`), and a name narrowed from
 * it reads the value as it is. A test in one alternative of an `or` reads only that alternative's
 * parts, so its collapse shortens paths there alone.
 */
function instantiatedPattern(checked: CheckedPattern, substitution: Substitution): CheckedPattern {
  return withoutVariantSteps(substitutedPattern(checked, substitution), []);
}

/** `checked` with its types substituted, as `instantiatedPattern` says. */
function substitutedPattern(checked: CheckedPattern, substitution: Substitution): CheckedPattern {
  const concrete = (type: Type) => substitute(type, substitution);
  const instantiatedTest = (patternTest: PatternTest): PatternTest => {
    switch (patternTest.kind) {
      case 'downcast':
        return {
          ...patternTest,
          from: substituteAny(patternTest.from, substitution),
          to: concrete(patternTest.to),
        };
      case 'member':
        return {
          ...patternTest,
          union: concrete(patternTest.union),
          members: patternTest.members.flatMap((member) => membersOf(concrete(member))),
        };
      case 'or':
        return {
          ...patternTest,
          alternatives: patternTest.alternatives.map((each) =>
            substitutedPattern(each, substitution),
          ),
        };
      case 'variant':
      case 'equal':
      case 'compare':
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
        type,
        narrowedFrom: from === undefined || sameType(from, type) ? undefined : from,
      };
    }),
  };
}

/**
 * `checked` with each path into a member's value at a collapsed part reading the part itself: the
 * parts `outer` collapsed, and those its own member tests did, which an alternative of its `or`
 * tests sees beside its own.
 */
function withoutVariantSteps(
  checked: CheckedPattern,
  outer: readonly (readonly PartStep[])[],
): CheckedPattern {
  const collapsed = [...outer, ...collapsedParts(checked)];
  const path = (steps: readonly PartStep[]) => collapsedSteps(steps, collapsed);
  return {
    tests: checked.tests.map((patternTest) =>
      patternTest.kind === 'or'
        ? {
            ...patternTest,
            alternatives: patternTest.alternatives.map((each) =>
              withoutVariantSteps(each, collapsed),
            ),
          }
        : { ...patternTest, path: path(patternTest.path) },
    ),
    bindings: checked.bindings.map((binding) => ({ ...binding, path: path(binding.path) })),
  };
}

/** The paths of the parts whose union one of `checked`'s own member tests collapsed into one type. */
function collapsedParts(checked: CheckedPattern): readonly (readonly PartStep[])[] {
  return checked.tests.flatMap((patternTest) =>
    patternTest.kind === 'member' && patternTest.union.kind !== 'union' ? [patternTest.path] : [],
  );
}

/**
 * `steps` without each step into a variant's value (field 0) taken at one of the `collapsed`
 * parts. Both are paths from the whole value as checked, so a part nested in a collapsed one is
 * found before either loses a step; a path below a part is built from the part's own, so its steps
 * are the very ones the part's path holds.
 */
function collapsedSteps(
  steps: readonly PartStep[],
  collapsed: readonly (readonly PartStep[])[],
): readonly PartStep[] {
  return steps.filter(
    (step, index) =>
      step !== 0 ||
      !collapsed.some(
        (part) => part.length === index && part.every((each, at) => each === steps[at]),
      ),
  );
}

/** `fit` as one instantiation makes it: the type a conversion converts into, substituted. */
function substitutedFit({ conversion, into }: Fit, substitution: Substitution): Fit {
  const union = into === undefined ? undefined : substitute(into.union, substitution);
  const member = into?.member === undefined ? undefined : substitute(into.member, substitution);
  return {
    conversion: substitutedConversion(conversion, substitution),
    into: union?.kind === 'union' ? { union, member } : undefined,
  };
}

function substitutedConversion(conversion: Fit['conversion'], substitution: Substitution) {
  switch (conversion.kind) {
    case 'any':
      return { kind: 'any', to: substituteAny(conversion.to, substitution) } as const;
    case 'shape':
      return { kind: 'shape', to: substituteKept(conversion.to, substitution) } as const;
    default:
      return conversion;
  }
}
