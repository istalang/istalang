/**
 * The data rule (proposal 8, Rule 2) over a checked body: code handles only data its mark allows,
 * so every value its body and its defaults handle is of no kind or of the function's own. It runs
 * once the body is checked, walking the body's nodes to find which function computes each, and
 * reading what the checked body records of each node:
 *
 * - the value an expression computes, where it is computed: one of a kind put into an `any` value,
 *   whose type hides it, is judged there, so such a value is made only in code of its kind, and no
 *   call or crossing takes it to the other's (§3.10);
 * - the type a value is fitted to where it is used, a union it is put into among them, and the
 *   type of each name a declaration, a pattern or a loop binds;
 * - the types each call it makes instantiates, written or implicit, its witnesses' included: its
 *   type arguments, and a requirement's `Self` and trait arguments; a generic callee handles its
 *   type parameters' values as simple data (Rule 3), so the code instantiating it handles them;
 * - for a lambda or a local `fn`, its signature and what it captures, judged by its own mark, and
 *   its body, a local `fn`'s held apart from the tree's nodes;
 * - for a field loop, each pass its body was checked in (§4).
 *
 * It reads a body once it is checked, as solved; what a nested function infers its mark from while
 * it is, it reads at the same sites (resolution/applying/call-kinds.ts `handledBy`).
 *
 * A deferred call's own call is made later, by the function its taker is given, of its callee's
 * kind (deferred-calls.ts), so what it gives is that function's, never the code writing it; what it
 * computes now is. One value per function is reported, the first its text holds: the mark it asks
 * for mends them all, or none does.
 *
 * A type's kinds are read off its fields' written types (properties/value-kinds.ts), so a field
 * whose type its default gives holds no part whose kind the type arguments decide (§3.3).
 */

import type { ModuleId } from '../../../program/program.ts';
import {
  declaredFunctionName,
  isFieldsFunction,
} from '../../../syntax/declarations/field-defaults.ts';
import {
  type ContextConstantDeclaration,
  type DeclaredStruct,
  type EnumDeclaration,
  type FunctionDeclaration,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../../../syntax/statements/index.ts';
import { awaits } from '../../../syntax/tokens/modifiers.ts';
import { fieldChildrenOf, type SyntaxNode } from '../../../syntax/tree/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { CheckedBody, NestedFunction, ValueSite } from '../../surface/checked-body.ts';
import {
  callsMadeWith,
  instantiatingTypesOf,
  type ResolvedCall,
} from '../../surface/resolved-call.ts';
import { partsDecidedBy } from '../../types/properties/value-kinds.ts';
import { mayBeOfKind } from '../../types/traits/data-kind.ts';
import { isComputed } from '../../types/type/computed-types.ts';
import { kindOfFunction, simpleMark } from '../../types/type/function-kinds.ts';
import { isNominalEntity, nominalType, type Type } from '../../types/type/index.ts';
import { markType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { type Holding, heldKindRefusal } from './signature-kinds.ts';

/**
 * Code whose values are being judged, whether one was refused already, and the types judged so far,
 * each of which its code may hold again: one function's values share few types.
 */
interface Handler extends Omit<Holding, 'held'> {
  reported: boolean;
  readonly judged: Set<Type>;
}

/** What judging one checked body needs: the checker, where it reports, and the body's records. */
interface Judging {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly body: CheckedBody;
  /** The calls the body makes, by the node making each. */
  readonly calls: ReadonlyMap<object, readonly ResolvedCall[]>;
}

/** What mends a value of a kind in a struct's defaults, which no mark can be written on. */
const fieldsRemedy =
  '; write the type of the field whose default makes it, which gives the type its kind';

/** Reports, per function in `declaration`'s body and defaults, the first value its mark refuses. */
export function checkDataKinds(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): void {
  const own = (): Handler => ({
    own: kindOfFunction(checker, declaration),
    holder: `'${declaredFunctionName(declaration)}'`,
    remedy: isFieldsFunction(declaration) ? fieldsRemedy : undefined,
    reported: false,
    judged: new Set(),
  });
  const body = checker.bodyOf(declaration);
  const block = checker.inputs.bodyOf(module, declaration);
  if (body !== undefined && block !== undefined) {
    judge(judgingOf(checker, module, body), block, own());
  }
  const defaults = checker.defaultsOf(declaration);
  if (defaults !== undefined) {
    const judging = judgingOf(checker, module, defaults);
    const handler = own();
    for (const parameter of declaration.parameters) {
      if (parameter.kind === 'Parameter' && parameter.defaultValue !== undefined) {
        judge(judging, parameter.defaultValue, handler);
      }
    }
  }
  if (isFieldsFunction(declaration)) {
    checkDefaultTypedFields(checker, module, declaration);
  }
}

/**
 * Reports each field `fields`, a fields function, reads whose type its default gives and holds a
 * part whose kind the type arguments decide: a type parameter that may be of a kind, or a type
 * they compute. A type's kinds are read off its written fields' types alone
 * (properties/value-kinds.ts), so such a field writes its type (§3.3).
 */
function checkDefaultTypedFields(
  checker: CheckerContext,
  module: ModuleId,
  fields: FunctionDeclaration,
): void {
  const parameters = typeParametersOf(fields.typeParameters);
  // A type of a kind of its own is judged where its default makes it; only one whose arguments
  // give it its kind, `Hook<T>` disposed of by live code at `Hook<Int>`, is of none yet.
  const decidesKind = (part: Type) => {
    if (part.kind === 'parameter') {
      return mayBeOfKind(checker, part);
    }
    return isComputed(part) || checker.valueKindsOf(part).length === 0;
  };
  for (const { node, type } of checker.parametersOf(fields)) {
    const { name } = node;
    const decided =
      node.type === undefined && name !== undefined
        ? partsDecidedBy(checker, type, parameters).find(decidesKind)
        : undefined;
    if (name !== undefined && decided !== undefined) {
      const diagnostic = checkerDiagnostics.defaultTypedFieldKind;
      checker.report(module, diagnostic(name.span, name.text, typeText(decided)));
    }
  }
}

/**
 * Reports the first value of a kind a top-level constant's initializer handles: a `const`'s is
 * simple code, a context constant's ista code (§3.4).
 */
export function checkConstantKinds(
  checker: CheckerContext,
  module: ModuleId,
  declaration: VariableDeclaration | ContextConstantDeclaration,
): void {
  const isContext = declaration.kind === 'ContextConstantDeclaration';
  const body = isContext
    ? checker.contextConstants.bodyOf(declaration)
    : checker.constantBodyOf(declaration);
  const own = isContext ? markType('ista') : simpleMark;
  const holder = isContext ? `'${declaration.name.text}'` : 'a constant';
  if (body !== undefined) {
    judge(judgingOf(checker, module, body), declaration.initializer, {
      own,
      holder,
      remedy: '',
      reported: false,
      judged: new Set(),
    });
  }
  if (isContext && declaration.type !== undefined) {
    const type = checker.contextConstants.typeOf(declaration);
    const held = [{ at: declaration.type.span, type }];
    const refusal = heldKindRefusal(checker, { own, holder, held });
    if (refusal !== undefined) {
      checker.report(module, refusal);
    }
  }
}

/**
 * Reports a struct or an enum whose values hold both kinds, which no code may handle, where it is
 * declared, its type parameters passing through as anywhere (Rule 3).
 */
export function checkDeclaredKinds(
  checker: CheckerContext,
  module: ModuleId,
  declaration: DeclaredStruct | EnumDeclaration,
): void {
  const entity = checker.bindings.entityOf(module, declaration.name);
  // A declaration the parser found no name for binds no type.
  if (entity?.kind !== 'type' || !isNominalEntity(entity)) {
    return;
  }
  const parameters = typeParametersOf(declaration.typeParameters);
  const own = nominalType(
    entity,
    parameters.map((parameter): Type => ({ kind: 'parameter', declaration: parameter })),
  );
  const [, other] = checker.valueKindsOf(own);
  if (other !== undefined) {
    checker.report(module, checkerDiagnostics.holdsBothKinds(declaration.name.span, typeText(own)));
  }
}

function judgingOf(checker: CheckerContext, module: ModuleId, body: CheckedBody): Judging {
  const calls = new Map<object, ResolvedCall[]>();
  for (const { site, call } of body.madeCalls()) {
    calls.set(site, [...(calls.get(site) ?? []), call]);
  }
  return { checker, module, body, calls };
}

function judge(judging: Judging, node: SyntaxNode, handler: Handler, now = true): void {
  if (now) {
    judgeNode(judging, node, handler);
  }
  const nested = nestedOf(judging, node);
  const inner = nested ?? handler;
  if (nested !== undefined) {
    judgeNested(judging, node as NestedFunction, nested);
  }
  const later = laterOf(node);
  for (const child of fieldChildrenOf(node)) {
    judge(judging, child, inner, !later.has(child));
  }
  if ('header' in node && node.header?.kind === 'FieldHeader') {
    for (const pass of judging.body.passesOf(node.header)) {
      const inPass = judgingOf(judging.checker, judging.module, pass.body);
      for (const child of fieldChildrenOf(node)) {
        judge(inPass, child, inner, !later.has(child));
      }
    }
  }
}

/** Judges what `judging`'s body records of `node`: its value, a name's type, a call's arguments. */
function judgeNode(judging: Judging, node: SyntaxNode, handler: Handler): void {
  const { body } = judging;
  const found = body.typeOf(node as Expression);
  const expected = body.expectedOf(node as ValueSite);
  const calls = judging.calls.get(node);
  const declared = node.kind === 'Identifier' ? body.declaredTypeOf(node) : undefined;
  // A value fitted where it is used is a value of the type it fits, a union it is put into, a
  // tuple's converted parts or what `Never` stands for (`none` for a `Socket?`); only one of a kind
  // can be refused, so only then is the fit tried.
  const fitted =
    found !== undefined &&
    expected !== undefined &&
    expected !== found &&
    judging.checker.valueKindsOf(expected).length > 0 &&
    judging.checker.fitOf(found, expected) !== undefined
      ? expected
      : undefined;
  judgeValues(judging, handler, node.span, [found, fitted, declared]);
  for (const call of calls ?? []) {
    for (const each of callsMadeWith(call)) {
      judgeValues(judging, handler, node.span, instantiatingTypesOf(each));
    }
  }
}

/** Reports the first of `types`, held at `at`, that `handler`'s mark refuses, unless one was. */
function judgeValues(
  judging: Judging,
  handler: Handler,
  at: AnchoredSpan,
  types: readonly (Type | undefined)[],
): void {
  for (const type of types) {
    if (!handler.reported && type !== undefined && !handler.judged.has(type)) {
      handler.judged.add(type);
      judgeValue(judging, handler, at, type);
    }
  }
}

/** Reports `type`, held at `at`, where `handler`'s mark refuses it. */
function judgeValue(judging: Judging, handler: Handler, at: AnchoredSpan, type: Type): void {
  // Most values are of no kind, which nothing refuses.
  if (judging.checker.valueKindsOf(type).length === 0) {
    return;
  }
  const refusal = heldKindRefusal(judging.checker, { ...handler, held: [{ at, type }] });
  if (refusal !== undefined) {
    judging.checker.report(judging.module, refusal);
    handler.reported = true;
  }
}

/** The handler of the values `node` computes, where it is a nested function checked in the body. */
function nestedOf(judging: Judging, node: SyntaxNode): Handler | undefined {
  if (node.kind !== 'Lambda' && node.kind !== 'FunctionDeclaration') {
    return undefined;
  }
  const checked = judging.body.functionOf(node as NestedFunction);
  return checked === undefined
    ? undefined
    : {
        own: checked.type.mark,
        holder: node.kind === 'Lambda' ? 'a lambda' : `'${node.name.text}'`,
        reported: false,
        judged: new Set(),
      };
}

/**
 * Judges a nested function by its own mark: its signature, what it captures, and a local `fn`'s
 * body, which the tree holds apart from its node. An async head's written `Future<…>` is what its
 * call gives, read as written (signature-kinds.ts).
 */
function judgeNested(judging: Judging, node: NestedFunction, handler: Handler): void {
  const checked = judging.body.functionOf(node);
  if (checked === undefined) {
    return;
  }
  const { checker, module } = judging;
  const written =
    awaits(node.qualifiers) && node.returnType !== undefined
      ? [checker.resolveType(module, node.returnType)]
      : [];
  judgeValues(judging, handler, node.span, [
    ...checked.type.parameters.map((slot) => slot.type),
    checked.type.result,
    ...written,
    ...checked.captures.map((capture) => capture.type),
  ]);
  const block =
    node.kind === 'FunctionDeclaration' ? checker.inputs.bodyOf(module, node) : undefined;
  if (block !== undefined) {
    judge(judging, block, handler);
  }
}

/** What no node but a deferred call makes later. */
const noneLater: ReadonlySet<SyntaxNode> = new Set();

/**
 * The nodes a deferred call `node` makes its call through later, its parentheses included, whose
 * values are the later function's; none for any other node.
 */
function laterOf(node: SyntaxNode): ReadonlySet<SyntaxNode> {
  if (node.kind !== 'DeferredCall') {
    return noneLater;
  }
  const later = new Set<SyntaxNode>();
  for (let call: Expression = node.call; ; call = call.expression) {
    later.add(call);
    if (call.kind !== 'Parenthesized') {
      return later;
    }
  }
}
