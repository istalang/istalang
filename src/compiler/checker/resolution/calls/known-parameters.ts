/**
 * The parameters a call's arguments fill whose types are known before any argument is checked
 * (§3.3, §3.5), so each such argument is checked against its parameter's type, top-down, as a
 * literal's field is, and a value that takes its type from where it stands (`Item{value: "s"}`,
 * `Options.Empty`) takes it from there; any other argument has a type of its own, which choosing
 * reads.
 *
 * - Only a call with one candidate knows them: a function whose type parameters the written type
 *   arguments give, else the expected type naming one instance of its result (`sameNominal`). A
 *   parameter mentioning a type parameter given neither way is left to choosing.
 * - Which calls take part is the caller's to say: a variant's constructor (§3.11). Every call with
 *   one candidate would take part the same way once calls read their expected type first.
 * - Arguments bind as a call binds them (../choosing/binding.ts), but a parameter no argument gives
 *   yet, as while the call is written, is left out, so every argument written has its type.
 */

import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { typeParametersOf } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Binding } from '../../surface/resolved-call.ts';
import { sameNominal } from '../../types/fitting/expected.ts';
import type { Substitution } from '../../types/parts/substitution.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import type { ParameterKey, Type } from '../../types/type/index.ts';
import { type BoundArgument, bindArguments, isBinding } from '../choosing/binding.ts';
import type { SignatureSlot } from '../choosing/call-arguments.ts';
import { signatureOf } from '../choosing/choice.ts';

/** What a call gives before its arguments are checked: type arguments, and what it must give. */
export interface KnownBeforeArguments {
  readonly typeArguments: readonly Type[] | undefined;
  readonly expected: Type | undefined;
  readonly arguments: readonly BoundArgument[];
}

/**
 * By argument written, the type of the parameter `declaration`, the call's one candidate, has it
 * fill, where known before the arguments; a spread's is its items'. Undefined where it isn't.
 */
export function knownParameterTypes(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
  call: KnownBeforeArguments,
): readonly (Type | undefined)[] {
  const parameters = typeParametersOf(declaration.typeParameters);
  const given = givenTypeArguments(checker, declaration, call);
  if (given === undefined) {
    return [];
  }
  const slots = signatureOf(checker, declaration, given).parameters;
  // While a call is written, a parameter no argument gives yet takes nothing from the others.
  const lenient = slots.map((slot) => ({ ...slot, hasDefault: true }));
  const binding = bindArguments(lenient, call.arguments);
  if (!isBinding(binding)) {
    return [];
  }
  const open = new Set<ParameterKey>(parameters.filter((parameter) => !given.has(parameter)));
  return slotTypes(slots, binding, call.arguments.length).map((type) =>
    type === undefined || parametersIn(type).some((parameter) => open.has(parameter))
      ? undefined
      : type,
  );
}

/**
 * The type arguments `declaration`'s call gives before its arguments: those written, in order, or
 * else those of the one instance of its result the expected type names; undefined for more
 * written than it takes.
 */
function givenTypeArguments(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
  { typeArguments, expected }: KnownBeforeArguments,
): Substitution | undefined {
  const parameters: readonly ParameterKey[] = typeParametersOf(declaration.typeParameters);
  if (typeArguments !== undefined) {
    return typeArguments.length > parameters.length
      ? undefined
      : new Map(
          typeArguments.flatMap((type, index) => {
            const parameter = parameters[index];
            return parameter === undefined ? [] : [[parameter, type] as const];
          }),
        );
  }
  const result = checker.resultOf(declaration);
  const instance =
    result.kind === 'nominal' ? sameNominal(expected, result.entity.declaration) : undefined;
  if (result.kind !== 'nominal' || instance === undefined) {
    return new Map();
  }
  return new Map(
    result.arguments.flatMap((argument, index) => {
      const type = instance.arguments[index];
      return argument.kind === 'parameter' &&
        parameters.includes(argument.declaration) &&
        type !== undefined
        ? [[argument.declaration, type] as const]
        : [];
    }),
  );
}

/** By argument, the type of the slot `binding` passes it to; its items' for a rest's. */
function slotTypes(
  slots: readonly SignatureSlot[],
  binding: Binding,
  count: number,
): readonly (Type | undefined)[] {
  const types: (Type | undefined)[] = Array.from({ length: count }, () => undefined);
  for (const [index, source] of binding.entries()) {
    const slot = slots[index];
    if (source.kind === 'argument') {
      types[source.index] = slot?.type;
    } else if (source.kind === 'rest' && slot?.rest?.kind === 'array') {
      for (const item of source.items) {
        types[item.index] = slot.rest.item;
      }
    }
  }
  return types;
}
