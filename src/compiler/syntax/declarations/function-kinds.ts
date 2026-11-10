/**
 * An unmarked function's kind (proposal 8, Rule 3): an implicit type parameter, settled at each
 * call to the caller's kind, which unmarked function types in its signature share.
 *
 * - It is synthesized from the declaration, as a struct's fields function is (field-defaults.ts),
 *   never written, so no name in source reaches it and no written type argument fills it: what
 *   reads a function's written type parameters reads `typeParametersOf`, what instantiates one
 *   reads `functionTypeParametersOf`.
 * - It stands for one of the two kinds, `in Persistence`, where the function needs a kind of its
 *   own: an async one, whose future has its kind, or one whose signature holds an unmarked async
 *   function type, whose future does. Where the signature holds only unmarked plain function
 *   types, it carries the caller's kind to them, and may stand for `Persistence` itself, either
 *   kind: the function's code is the same whatever it stands for.
 * - A function whose signature holds no unmarked function type and that isn't async has none: it
 *   runs the same in both worlds, of either kind, so nothing settles for it at a call.
 * - A function whose head names its mark (`M fn`) or whose signature names a kind variable of its
 *   own (`K in Persistence`, `M in DataKind`) has that as its kind (Rule 3), and no implicit one.
 */

import { memo } from '../../../foundation/structures/memo.ts';
import { awaits, type FunctionQualifiers } from '../tokens/modifiers.ts';
import { fieldChildrenOf, type SyntaxNode } from '../tree/index.ts';
import type { TypeNode } from '../types/index.ts';
import { type FunctionDeclaration, type TypeParameter, typeParametersOf } from './index.ts';

/** The prelude's union of the two kinds, which a kind parameter stands for a member of. */
const persistenceName = 'Persistence';

/** The prelude's union of every mark, simple and the two kinds, which a mark parameter takes. */
const dataKindName = 'DataKind';

/** The prelude's union of what a function's values may capture. */
const sendabilityName = 'Sendability';

/** What the implicit kind parameter of `declaration` is called where a message names it. */
const kindParameterName = 'kind';

/**
 * How an unmarked function uses a kind of its own: as one of the two (`own`), only carried to the
 * function types in its signature (`carried`), or not at all.
 */
type KindUse = 'own' | 'carried' | undefined;

const implicitKinds = new WeakMap<FunctionDeclaration, TypeParameter | undefined>();
const owners = new WeakMap<TypeParameter, FunctionDeclaration>();

/** The implicit kind parameter of `declaration`, an unmarked function using one; else undefined. */
export function kindParameterOf(declaration: FunctionDeclaration): TypeParameter | undefined {
  return memo(implicitKinds, declaration, () => {
    if (
      declaration.qualifiers.kind !== undefined ||
      declaration.mark !== undefined ||
      writtenKindParameterOf(declaration) !== undefined
    ) {
      return;
    }
    const use = kindUseOf(declaration);
    return use === undefined ? undefined : synthesizedKind(declaration, use);
  });
}

/** Whether `parameter` is a function's implicit kind parameter. */
export function isImplicitKind(parameter: TypeParameter): boolean {
  return owners.has(parameter);
}

/** The function an implicit kind parameter is of; undefined for any other type parameter. */
export function kindOwnerOf(parameter: TypeParameter): FunctionDeclaration | undefined {
  return owners.get(parameter);
}

/** The kind parameter `declaration` writes among its own (`K in Persistence`), if it does. */
export function writtenKindParameterOf(
  declaration: Pick<FunctionDeclaration, 'typeParameters'>,
): TypeParameter | undefined {
  return typeParametersOf(declaration.typeParameters).find(isKindParameter);
}

/** The type parameters a call of `declaration` infers: its written ones, then its implicit kind. */
export function functionTypeParametersOf(
  declaration: FunctionDeclaration,
): readonly TypeParameter[] {
  const kind = kindParameterOf(declaration);
  const written = typeParametersOf(declaration.typeParameters);
  return kind === undefined ? written : [...written, kind];
}

/**
 * Whether `parameter` stands for a mark: a function's implicit kind, one of the two kinds
 * (`K in Persistence`), or any mark, simple included (`M in DataKind`).
 */
export function isKindParameter(parameter: TypeParameter): boolean {
  return (
    isImplicitKind(parameter) ||
    isMemberOfNamed(parameter, persistenceName) ||
    isMemberOfNamed(parameter, dataKindName)
  );
}

/** Whether `parameter` stands for a function's sendability, `S in Sendability` (§3.14). */
export function isSendabilityParameter(parameter: TypeParameter): boolean {
  return isMemberOfNamed(parameter, sendabilityName);
}

/** Whether `parameter` stands for any mark, simple included: `M in DataKind`. */
export function standsForAnyMark(parameter: TypeParameter): boolean {
  return isMemberOfNamed(parameter, dataKindName);
}

/** Whether `parameter` stands for one of the two kinds: `K in Persistence`, written or implicit. */
export function standsForOneKind(parameter: TypeParameter): boolean {
  return isMemberOfNamed(parameter, persistenceName);
}

function isMemberOfNamed(parameter: TypeParameter, union: string): boolean {
  return (
    parameter.memberOf?.kind === 'NamedType' &&
    parameter.memberOf.path.length === 1 &&
    parameter.memberOf.path[0].text === union
  );
}

function synthesizedKind(declaration: FunctionDeclaration, use: KindUse): TypeParameter {
  const at = declaration.name.span;
  const parameter: TypeParameter = {
    kind: 'TypeParameter',
    span: at,
    variance: undefined,
    isPack: false,
    name: { kind: 'Identifier', span: at, text: kindParameterName },
    memberOf:
      use === 'own'
        ? {
            kind: 'NamedType',
            span: at,
            path: [{ kind: 'Identifier', span: at, text: persistenceName }],
            typeArguments: [],
          }
        : undefined,
    constraints: [],
    defaultType: undefined,
  };
  owners.set(parameter, declaration);
  return parameter;
}

function kindUseOf(declaration: FunctionDeclaration): KindUse {
  const signature = signatureTypesOf(declaration);
  if (awaits(declaration.qualifiers) || signature.some((type) => holds(type, unmarkedAsync))) {
    return 'own';
  }
  return signature.some((type) => holds(type, unmarked)) ? 'carried' : undefined;
}

function signatureTypesOf(declaration: FunctionDeclaration): readonly TypeNode[] {
  const parameters = declaration.parameters.flatMap((parameter) =>
    parameter.kind === 'Parameter' && parameter.type !== undefined ? [parameter.type] : [],
  );
  return declaration.returnType === undefined
    ? parameters
    : [...parameters, declaration.returnType];
}

/** Whether `node` holds, at any depth, a function type whose head meets `isHeld`. */
function holds(node: SyntaxNode, isHeld: (qualifiers: FunctionQualifiers) => boolean): boolean {
  return (
    (node.kind === 'FunctionType' && isHeld(node.qualifiers)) ||
    fieldChildrenOf(node).some((child) => holds(child, isHeld))
  );
}

function unmarked(qualifiers: FunctionQualifiers): boolean {
  return qualifiers.kind === undefined;
}

function unmarkedAsync(qualifiers: FunctionQualifiers): boolean {
  return awaits(qualifiers) && unmarked(qualifiers);
}
