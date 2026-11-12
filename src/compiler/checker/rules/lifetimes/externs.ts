/**
 * What the std's externs hold and keep (§3.16), which no code shows: `lifetimes`' `@Holds` on an
 * extern struct and `@Keeps` on an extern function, read here for every reader, what a value holds
 * (types/properties/held.ts) among them. Where either may stand is rules/annotations.ts's.
 *
 * - `@Holds<X>` lists what a value holds as a tuple lists its elements: `X`'s elements, `()` none,
 *   or `X` alone where it is no tuple. Without it, a value holds its type arguments. Like a field's
 *   type, it names no instance of its own type that grows (§3.5), so every walk over what values
 *   hold meets finitely many types.
 * - `@Keeps` names parameters, each reported where it names none of the function's. Without it, a
 *   parameter taken by `&` keeps every other: writing through it may store any of them (§3.7).
 * - Both are read by parameter and type position, never by name, so a later phase reads what a
 *   call's arguments keep without spelling the names again.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import type {
  ExternStructDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import { nodesUnder } from '../../../syntax/tree/index.ts';
import type { Kept } from '../../check.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { type CheckedAnnotation, functionPlace } from '../../surface/checked-annotation.ts';
import { substitute, substitutionFor } from '../../types/parts/substitution.ts';
import type { NominalType, Type } from '../../types/type/index.ts';
import { tupleElements } from '../../types/type/primitives.ts';

type Reader = Pick<
  CheckerContext,
  | 'annotations'
  | 'moduleOf'
  | 'wellKnownEntity'
  | 'typeRules'
  | 'inputs'
  | 'report'
  | 'parametersOf'
>;

/**
 * What a value of the extern type `type` holds one level down: what its declaration's `@Holds`
 * names, at `type`'s arguments; its arguments without one.
 */
export function externHeldOf(checker: Reader, type: NominalType): readonly Type[] {
  const { declaration } = type.entity;
  if (declaration.kind !== 'ExternStructDeclaration') {
    return type.arguments;
  }
  const holds = annotationNamed(checker, declaration, 'holds')?.type.arguments[0];
  if (holds === undefined) {
    return type.arguments;
  }
  const held = substitute(
    holds,
    substitutionFor(declaration.typeParameters, type.arguments),
    checker.typeRules,
  );
  return tupleElements(held) ?? [held];
}

/**
 * What each parameter of the extern function `declaration` comes to keep: its `@Keeps`, a name no
 * parameter has keeping nothing (`checkKeeps` reports it); without one, each `&` parameter keeps
 * every other.
 */
export function keepsOf(checker: Reader, declaration: FunctionDeclaration): readonly Kept[] {
  const keeps = annotationNamed(checker, declaration, 'keeps');
  if (keeps === undefined) {
    const parameters = checker.parametersOf(declaration);
    const others = (position: number) =>
      parameters.flatMap((_, other) => (other === position ? [] : [other]));
    return parameters.flatMap(({ reference }, holder) =>
      reference ? [{ holder, kept: others(holder) }] : [],
    );
  }
  const positions = positionsOf(checker, declaration);
  return keptNames(keeps).flatMap(([holderName, kept]) => {
    const holder = positions.get(holderName);
    const keptPositions = kept.flatMap((name) => positions.get(name) ?? []);
    return holder === undefined ? [] : [{ holder, kept: keptPositions }];
  });
}

/**
 * Reports each name the `@Keeps` of `declaration` gives that none of its parameters has, at each
 * String literal spelling it, or at the annotation where none does, its value computed from
 * constants.
 */
export function checkKeeps(checker: Reader, declaration: FunctionDeclaration): void {
  const keeps = annotationNamed(checker, declaration, 'keeps');
  if (keeps === undefined) {
    return;
  }
  const positions = positionsOf(checker, declaration);
  const named = keptNames(keeps).flatMap(([holder, kept]) => [holder, ...kept]);
  const module = checker.moduleOf(declaration);
  const spellings = nodesUnder(checker.inputs.treeOf(module), keeps.node.value);
  for (const name of new Set(named.filter((each) => !positions.has(each)))) {
    const spelled = spellings.filter(
      (node) => node.kind === 'StringLiteral' && node.value === name,
    );
    for (const { span } of spelled.length > 0 ? spelled : [keeps.node]) {
      checker.report(
        module,
        checkerDiagnostics.keepsUnknownParameter(span, name, declaration.name.text),
      );
    }
  }
}

/** The position of each of `declaration`'s parameters, by its name. */
function positionsOf(checker: Reader, declaration: FunctionDeclaration): Map<string, number> {
  const parameters = checker.parametersOf(declaration);
  return new Map(
    parameters.flatMap(({ node }, position) =>
      node.name === undefined ? [] : [[node.name.text, position] as const],
    ),
  );
}

/**
 * The `@Holds` or `@Keeps` among `declaration`'s annotations, if it has it; one written with none,
 * as most are, reads no checked annotation, since what a value holds is asked at every step of
 * walks over types.
 */
function annotationNamed(
  checker: Reader,
  declaration: ExternStructDeclaration | FunctionDeclaration,
  name: 'holds' | 'keeps',
): CheckedAnnotation | undefined {
  if (declaration.annotations === undefined) {
    return undefined;
  }
  const entity = checker.wellKnownEntity(wellKnown[name]);
  const module = checker.moduleOf(declaration);
  const place =
    declaration.kind === 'FunctionDeclaration'
      ? functionPlace(declaration)
      : { kind: 'struct' as const, isExtern: true };
  const annotations = checker.annotations.of(module, declaration, place);
  return annotations.find((annotation) => annotation.type.entity === entity);
}

/** The names a `@Keeps` lists: each holder's, with the names of what it keeps. */
function keptNames(keeps: CheckedAnnotation): readonly (readonly [string, readonly string[]])[] {
  const [into] = keeps.form.kind === 'struct' ? keeps.form.fields : [];
  if (into?.kind !== 'map') {
    return [];
  }
  return into.entries.flatMap(([key, value]) => {
    const names = value.kind === 'array' ? value.elements.flatMap(textOf) : [];
    return textOf(key).map((holder) => [holder, names] as const);
  });
}

function textOf(form: CheckedAnnotation['form']): readonly string[] {
  return form.kind === 'primitive' && typeof form.value === 'string' ? [form.value] : [];
}
