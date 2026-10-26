/**
 * Overload clashes (§3.3, §3.7): two functions of one name, or two static functions of one name
 * on one type, whose parameters have the same types are an error, since no call could choose
 * between them. What "the same" means:
 *
 * - each parameter is by value or by `&` alike, except a method's `self`, since method notation
 *   passes it either way (§3.7);
 * - a parameter's `T` and `T?` count as the same, since the implicit wrap (§2) would make every
 *   call to the pair ambiguous;
 * - generic functions compare up to the names of their type parameters, so two with different
 *   numbers of them never clash: written type arguments tell them apart (§3.7);
 * - a function with defaults stands for every shorter overload it generates (§3.3).
 *
 * A module's functions are compared with each other and with the prelude's of the same name, which
 * they join (§3.13); a clash is reported at the later declaration.
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { optionalInner } from '../types/fit.ts';
import { typeParametersOf } from '../types/resolve-type.ts';
import { mentionsError, type ParameterKey, type Type } from '../types/type.ts';

/** Reports every function of `module` that clashes with an earlier one, or with the prelude's. */
export function checkClashes(checker: CheckerContext, module: ModuleId): void {
  const items = checker.program.modules.get(module)?.tree.root.items ?? [];
  const groups = new Map<string, FunctionDeclaration[]>();
  const functions = items.filter((item) => item.kind === 'FunctionDeclaration');
  for (const item of functions) {
    const group = groupOf(checker, module, item);
    const earlier = groups.get(group) ?? [];
    const shapes = new Set(shapesOf(checker, item));
    const clashing = [...earlier, ...preludeOverloads(checker, module, item)].some((other) =>
      shapesOf(checker, other).some((shape) => shapes.has(shape)),
    );
    if (clashing) {
      checker.report(module, checkerDiagnostics.overloadClash(item.name.span, item.name.text));
    }
    groups.set(group, [...earlier, item]);
  }
}

/** Which functions `declaration` may clash with: its name, and its type for a static function. */
function groupOf(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): string {
  if (declaration.owner === undefined) {
    return declaration.name.text;
  }
  return `${ownerKeyOf(checker, module, declaration.owner)}.${declaration.name.text}`;
}

/** The type a static function's owner names, as a key: its declaration, or the primitive. */
function ownerKeyOf(checker: CheckerContext, module: ModuleId, owner: Identifier): string {
  const entity = checker.bindings.entityOf(module, owner);
  if (entity?.kind === 'primitive') {
    return entity.name;
  }
  return entity?.kind === 'type'
    ? `#${checker.typeKeys.identityOf(entity.declaration)}`
    : owner.text;
}

function preludeOverloads(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): readonly FunctionDeclaration[] {
  return declaration.owner === undefined && module !== checker.program.roles.prelude
    ? checker.languageFunctions('prelude', declaration.name.text)
    : [];
}

/**
 * The parameter lists a call could match `declaration` by: one per number of arguments it takes.
 * A parameter type that didn't resolve was reported already, so it clashes with nothing.
 */
function shapesOf(checker: CheckerContext, declaration: FunctionDeclaration): readonly string[] {
  const parameters = checker.parametersOf(declaration);
  if (parameters.some((parameter) => mentionsError(parameter.type))) {
    return [];
  }
  const positions = new Map<ParameterKey, number>(
    typeParametersOf(declaration.typeParameters).map((parameter, index) => [parameter, index]),
  );
  const slots = parameters.map((parameter, index) => {
    const isSelf = index === 0 && parameter.node.name.text === 'self';
    const reference = parameter.reference && !isSelf ? '&' : '';
    return (
      reference + checker.typeKeys.typeKey(withoutOptional(checker, parameter.type), positions)
    );
  });
  const required = parameters.filter(
    (parameter) => parameter.node.defaultValue === undefined,
  ).length;
  const generic = `<${positions.size}>`;
  return slots
    .slice(required)
    .map((_, index) => generic + slots.slice(0, required + index).join(','))
    .concat([generic + slots.join(',')]);
}

/** `type` with its outer optionals removed: `T??` reads as `T`. */
function withoutOptional(checker: CheckerContext, type: Type): Type {
  const inner = optionalInner(type, checker.optionalEntity);
  return inner === undefined ? type : withoutOptional(checker, inner);
}
