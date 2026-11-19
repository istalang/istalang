/**
 * What a function declaration promises before its body is checked: its parameters and declared
 * result (§6.1).
 *
 * - A declared function's parameter carries its type: its annotation, or the type its pattern
 *   names (`Point{x, y}`), never both, since one type would be written twice; else its default
 *   gives one, and a parameter with none of these is reported. `&T` takes a reference (§7.3), which
 *   a pattern can't take apart, since it passes a place.
 * - An async function declares its real result, `Future<T>`; its body produces the `T` (§6.1).
 * - A parameter's default (§6.1) is checked as part of one body per function, in which each default
 *   sees the parameters before it (`DefaultValues`). A parameter with a default may omit its type,
 *   which is then the default's. Every parameter after one with a default has one too, since a call
 *   gives its arguments in order, as it does a variant's fields; a struct's fields, read as
 *   parameters (syntax/declarations/field-defaults.ts), are named in a literal, so any of them may
 *   have one.
 * - A rest parameter is the last, an `Array<T>` with no default (§6.1): a call it collects nothing
 *   into gives it an empty array.
 */

import type { Diagnostic } from '../../../../../foundation/diagnostics/diagnostic.ts';
import type { ModuleId } from '../../../../program/program.ts';
import {
  isFieldsFunction,
  takesArgumentsInOrder,
} from '../../../../syntax/declarations/field-defaults.ts';
import {
  type FunctionDeclaration,
  typeParametersOf,
} from '../../../../syntax/declarations/index.ts';
import type { Expression, Parameter } from '../../../../syntax/expressions/index.ts';
import {
  parameterSite,
  patternNamedType,
  writtenByReference,
} from '../../../../syntax/expressions/parameters.ts';
import { awaits } from '../../../../syntax/tokens/modifiers.ts';
import { lastName } from '../../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { NamedType, TypeNode } from '../../../../syntax/types/index.ts';
import type { SignatureParameter } from '../../../check.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { isPack, packRestSlot, type RestSlot } from '../../../types/type/function-types.ts';
import { nominalType, type Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { arrayElement, awaitedOf } from '../../../types/type/well-known.ts';
import { nominalEntityOf } from '../../../types/written/named-types.ts';
import { patternTypeOf } from '../../../types/written/pattern-types.ts';
import { parameterType } from '../../../types/written/resolve-type.ts';

/** Where a function's defaults are checked: one body, seeing each parameter once declared. */
export interface DefaultValues {
  /** Checks a default value against the parameter's declared type, if any; the value's type. */
  readonly check: (value: Expression, declared: Type | undefined) => Type;
  /** Makes a parameter visible to the defaults after it. */
  readonly declare: (parameter: Parameter, type: Type) => void;
}

/** The parameters of `declaration`, their types resolved in its module, its defaults checked. */
export function declaredParameters(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
  defaults: DefaultValues | undefined,
): readonly SignatureParameter[] {
  let afterDefault = false;
  const inOrder = takesArgumentsInOrder(declaration);
  const last = declaration.parameters.at(-1);
  return declaration.parameters.flatMap((node) => {
    if (node.kind === 'Invalid') {
      return [];
    }
    const site = {
      checker,
      module,
      report: (found: Diagnostic<AnchoredSpan>) => checker.report(module, found),
    };
    checkPatternParameter(site, node, writtenByReference(node));
    const written = writtenTypeOf(checker, module, node);
    const declared = written === undefined ? undefined : checker.resolveType(module, written);
    if (node.isRest) {
      checkRest(checker, module, { node, declared, isLast: node === last });
    }
    const { defaultValue } = node;
    checkGiven(checker, module, node, { declared, defaultBefore: afterDefault && inOrder });
    afterDefault ||= defaultValue !== undefined;
    const valueType =
      defaultValue === undefined || defaults === undefined
        ? undefined
        : defaults.check(defaultValue, declared);
    const type = declared ?? valueType ?? errorType;
    defaults?.declare(node, type);
    return [signatureParameter(checker, node, type)];
  });
}

/**
 * Reports a parameter a call could leave without a value, after one with a default, and one with
 * no type: neither written nor taken from a default (§6.1).
 */
function checkGiven(
  checker: CheckerContext,
  module: ModuleId,
  node: Parameter,
  {
    declared,
    defaultBefore,
  }: { readonly declared: Type | undefined; readonly defaultBefore: boolean },
): void {
  const { span } = parameterSite(node);
  const name = node.name?.text;
  if (node.defaultValue === undefined && defaultBefore && !node.isRest) {
    checker.report(module, checkerDiagnostics.defaultMissing(span, name));
  }
  if (declared === undefined && node.defaultValue === undefined) {
    checker.report(module, checkerDiagnostics.parameterTypeMissing(span, name));
  }
}

/**
 * The parameters of `declaration` as written, a type taken from a default read as the error type.
 * It reports nothing, so it can stand for the parameters while their defaults reach them.
 */
export function writtenParameters(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): readonly SignatureParameter[] {
  return declaration.parameters.flatMap((node) => {
    if (node.kind === 'Invalid') {
      return [];
    }
    const written = writtenTypeOf(checker, module, node);
    const type = written === undefined ? errorType : checker.resolveType(module, written);
    return [signatureParameter(checker, node, type)];
  });
}

/**
 * The type `node` is written with: its annotation, or the type its pattern names when that names a
 * type, not a variant, which a pattern can fail on (§11.3).
 */
export function writtenTypeOf(
  checker: CheckerContext,
  module: ModuleId,
  node: Parameter,
): TypeNode | undefined {
  return node.type ?? namedByPattern(checker, module, node);
}

function namedByPattern(
  checker: CheckerContext,
  module: ModuleId,
  node: Parameter,
): NamedType | undefined {
  const named = patternNamedType(node);
  return named !== undefined &&
    checker.bindings.entityOf(module, lastName(named.path))?.kind === 'type'
    ? named
    : undefined;
}

/**
 * The type a nested function's parameter `node` is written with whole: its annotation, or the type
 * its pattern names with its type arguments; undefined where it is left to its place.
 */
export function wholeWrittenTypeOf(
  checker: CheckerContext,
  module: ModuleId,
  node: Parameter,
): TypeNode | undefined {
  return node.type ?? wholeTypeNamedByPattern(checker, module, node);
}

/**
 * The type `node`'s pattern names whole: with its type arguments, or one that takes none. A
 * generic one named bare is left to what the parameter's place gives, a lambda's expected type.
 */
function wholeTypeNamedByPattern(
  checker: CheckerContext,
  module: ModuleId,
  node: Parameter,
): NamedType | undefined {
  const named = namedByPattern(checker, module, node);
  if (named === undefined || named.typeArguments.length > 0) {
    return named;
  }
  const entity = checker.bindings.entityOf(module, lastName(named.path));
  const generic = entity !== undefined && patternTypeOf(checker, entity).kind.startsWith('generic');
  return generic ? undefined : named;
}

/** Where a parameter's form is checked: its module, and where what it finds goes. */
interface ParameterSite {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly report: (diagnostic: Diagnostic<AnchoredSpan>) => void;
}

/**
 * Reports a type written twice, as an annotation beside a pattern naming it, and a pattern taking
 * apart what `&` passes, a place (§6.1, §7.3), whether the parameter is `byReference` as written or
 * as the function type a lambda is expected as gives it. A declared function's and a nested one's
 * parameters are held to both alike.
 */
export function checkPatternParameter(
  site: ParameterSite,
  node: Parameter,
  byReference: boolean,
): void {
  const { checker, module } = site;
  const named = namedByPattern(checker, module, node);
  if (node.type !== undefined && named !== undefined) {
    const type = typeText(checker.resolveType(module, named));
    site.report(checkerDiagnostics.patternTypeTwice(node.type.span, type));
  }
  if (node.pattern !== undefined && byReference) {
    site.report(checkerDiagnostics.patternByReference(node.pattern.span));
  }
}

function signatureParameter(
  checker: CheckerContext,
  node: Parameter,
  type: Type,
): SignatureParameter {
  return { node, type, reference: writtenByReference(node), rest: restSlotOf(checker, node, type) };
}

/** What a rest parameter of type `type` collects into: a pack's tuple, or an array of its items. */
function restSlotOf(checker: CheckerContext, node: Parameter, type: Type): RestSlot | undefined {
  if (!node.isRest) {
    return undefined;
  }
  return isPack(type)
    ? packRestSlot
    : { kind: 'array', item: arrayElement(checker, type) ?? errorType };
}

/**
 * Reports what a rest parameter breaks of its rules: last, an array or a pack, no default (§6.1).
 */
function checkRest(
  checker: CheckerContext,
  module: ModuleId,
  rest: { readonly node: Parameter; readonly declared: Type | undefined; readonly isLast: boolean },
): void {
  const { node, declared, isLast } = rest;
  const site = parameterSite(node);
  const name = node.name?.text ?? '';
  if (!isLast) {
    checker.report(module, checkerDiagnostics.restNotLast(site.span, name));
  }
  if (node.defaultValue !== undefined) {
    checker.report(module, checkerDiagnostics.restDefault(site.span, name));
  }
  const collects =
    declared === undefined ||
    declared.kind === 'error' ||
    isPack(declared) ||
    arrayElement(checker, declared) !== undefined;
  if (!collects) {
    const at = node.type?.span ?? site.span;
    checker.report(module, checkerDiagnostics.restNotArray(at, name, typeText(declared)));
  }
}

/**
 * What `declaration` declares its body produces: what `declaredBodyResult` reads of it, or, for
 * the function a declaration's fields read as, the value they make, which is never written: its
 * struct, or its variant's enum, over the declaration's own type parameters (§5.2, §5.3).
 */
export function declaredResultOf(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): Type | undefined {
  if (!isFieldsFunction(declaration)) {
    return declaredBodyResult(checker, declaration, (node) => checker.resolveType(module, node));
  }
  const { fieldsOwner } = declaration;
  const owner = 'struct' in fieldsOwner ? fieldsOwner.struct : fieldsOwner.enumeration;
  const parameters = typeParametersOf(owner.typeParameters).map(parameterType);
  return nominalType(nominalEntityOf(checker, owner), parameters);
}

/**
 * What the body of `declaration` must produce, when its result is declared: the result itself, or,
 * where an async head spells the future its call gives, `Future<T, K>`'s `T` (proposal 8, Rule 2).
 * Undefined when the result is to be inferred.
 */
export function declaredBodyResult(
  checker: CheckerContext,
  declaration: Pick<FunctionDeclaration, 'qualifiers' | 'returnType'>,
  resolve: (node: TypeNode) => Type,
): Type | undefined {
  if (declaration.returnType === undefined) {
    return undefined;
  }
  const declared = resolve(declaration.returnType);
  return awaits(declaration.qualifiers)
    ? (awaitedOf(checker, declared)?.value ?? declared)
    : declared;
}
