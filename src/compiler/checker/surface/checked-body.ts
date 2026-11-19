/**
 * A body as checked (§2–§11), the model check.ts names (`Checker.bodyOf`, `defaultsOf`,
 * `constantBodyOf`): every fact its check recorded of its nodes (`BodyFacts`), so lowering reads
 * exactly what was checked and never re-derives a type, and the records those facts answer with:
 * the functions nested in it and their parameters, where a literal's fields get their values, the
 * parts an assignment writes, an optional chain's links, iterations and labels. body/ records and
 * answers it, per pass of the field loops it holds (passes.ts).
 */

import type { VariableEntity, VariantEntity } from '../../binder/entities.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type { CallingNode } from '../../syntax/expressions/calls.ts';
import type {
  ArrayLiteral,
  Comprehension,
  Expression,
  FieldLoopHeader,
  FieldsLiteral,
  Lambda,
  MapLiteral,
  Spread,
  StructComprehension,
} from '../../syntax/expressions/index.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import type { Pattern, PatternArgument, PatternPart } from '../../syntax/patterns.ts';
import type {
  Assignment,
  Block,
  Break,
  Continue,
  For,
  Hold,
  LabelledScope,
  Return,
} from '../../syntax/statements/index.ts';
import { fieldChildrenOf, nestsFunction, type SyntaxNode } from '../../syntax/tree/index.ts';
import type { Identifier, NodeOf } from '../../syntax/tree/node.ts';
import type { TypeNode } from '../../syntax/types/index.ts';
import type { Checker, SignatureParameter } from '../check.ts';
import type { FieldPassType, PassRecords } from '../contexts/passes.ts';
import type { Fit } from '../types/fitting/fit/index.ts';
import type { Substitution } from '../types/parts/substitution.ts';
import type { FieldMember, FunctionType, Type } from '../types/type/index.ts';
import type { TypeRules } from '../types/type/type-rules.ts';
import type { FieldRead, FieldReading } from './checked-field.ts';
import type {
  CheckedPattern,
  FieldsPattern,
  TargetBinding,
  TargetOwner,
  TargetStep,
} from './checked-pattern.ts';
import type { JoinedBody } from './denotation.ts';
import type { FlowFunction } from './flow-ir.ts';
import type {
  FunctionCall,
  FunctionNaming,
  ImplicitRole,
  MadeCall,
  ResolvedCall,
  ResolvedSite,
  ValueCallMade,
} from './resolved-call.ts';

/**
 * The kinds of node checking desugars (checker/desugaring/): a sugar is checked as the core tree it
 * means where it is written, and every later phase reads that tree in its place (`coreOf`), never
 * the sugar; tools reading a position and the formatter keep the written one.
 */
const sugarKinds = [
  'ChainedComparison',
  'DeferredCall',
  'IndentedValue',
  'Range',
  'TemplateLiteral',
  'Unwrap',
] as const;

export type SugarKind = (typeof sugarKinds)[number];

/** A written node checking desugars. */
export type Sugar = Extract<Expression, { readonly kind: SugarKind }>;

/** An expression of the core language: any but a sugar, which only checking reads. */
export type CoreExpression = Exclude<Expression, Sugar>;

export function isSugar(node: Expression): node is Sugar {
  return (sugarKinds as readonly string[]).includes(node.kind);
}

/** The children of `node` as checked: a sugar's, the core tree it was checked as (`coreOf`). */
export function checkedChildrenOf(
  node: SyntaxNode,
  coreOf: (node: Expression) => CoreExpression | undefined,
): readonly SyntaxNode[] {
  const core = isSugar(node as Expression) ? coreOf(node as Expression) : undefined;
  return core === undefined ? fieldChildrenOf(node) : [core];
}

/**
 * The children of `node` as checked that run where it stands (`bodyChildrenOf`), so a walk over a
 * checked body meets only core code, and never code that runs later.
 */
export function childrenRunning(
  node: SyntaxNode,
  coreOf: (node: Expression) => CoreExpression | undefined,
): readonly SyntaxNode[] {
  return nestsFunction(node) ? [] : checkedChildrenOf(node, coreOf);
}

/**
 * A lambda or local function as checked (§6.4): its type, what its body gives, its parameters as
 * checked, in order, a rest one a pack's (§8.1), and what it captures in the order first used.
 * Lowering makes it a function-table entry of its own.
 */
export interface CheckedFunction {
  readonly type: FunctionType;
  /** What its body gives: its type's result, or the value of the future an async one's call gives. */
  readonly result: Type;
  readonly parameters: readonly SignatureParameter[];
  readonly captures: readonly Capture[];
}

/** A function nested in a body: a lambda, or a local `fn` (a `const` bound to one, §6.4). */
export type NestedFunction = Lambda | FunctionDeclaration;

/** A variable a closure captures, with its type, at where the function first uses it (§6.4). */
export interface Capture {
  readonly entity: VariableEntity;
  readonly type: Type;
  readonly site: Identifier;
}

/**
 * Where a struct literal's field, named `field`, gets its value (§5.2): an expression of the
 * literal, the field of that name in its leading spread's value, or its default, which `call`,
 * of the function the fields read as, computes from the fields before it as it starts
 * (syntax/declarations/field-defaults.ts): the one call building the literal's value, given the
 * fields it gives and leaving the rest to their defaults, the same for each. A literal's sources come in declaration order, the order
 * evaluation follows; its value takes its type's layout by the fields' names (`laidOut`). A struct
 * comprehension (§5.2) is the source of every field it gives, one per field of the struct each
 * instantiation runs it over, so it names none.
 */
export type FieldSource =
  | ({ readonly field: string } & (
      | { readonly kind: 'value'; readonly value: Expression }
      | { readonly kind: 'spread'; readonly from: Expression }
      | { readonly kind: 'default'; readonly call: FunctionCall }
    ))
  | { readonly kind: 'comprehension'; readonly comprehension: StructComprehension };

/**
 * A link of an optional chain (§10.4): the type its own step works on (the value inside, after
 * `?.`), and the value it carries along the chain, which the chain, if it ends at this link,
 * wraps into its `T?` unless it is optional already. An instantiation may make it so (§8.1).
 */
export interface ChainLink {
  readonly base: Type;
  readonly carried: Type;
}

/**
 * How a value written to a place converts to fit it (§4.1, §8.2, §6.4): as checked, or, where a key
 * that may name several fields reads the place (§10.2), into whichever field the key names, each
 * conversion derived from the field types the instantiation makes concrete. A key of several names
 * in a generic body may name one field once instantiated, which then takes the value as that one
 * field's conversion says.
 */
export type WrittenFit = Fit | 'intoKeyedField';

/**
 * A part of an assigned value and where it goes (§4.5): the steps to it in the value (tuple
 * positions and struct fields) and its type; written to the place its target names, converted to
 * fit it, or held by `_`, a variable with no name, until the assignment's block ends (§16).
 */
export type AssignedPart =
  | {
      readonly kind: 'place';
      readonly target: Expression;
      readonly path: readonly TargetStep[];
      readonly type: Type;
      readonly fit: WrittenFit;
    }
  | {
      readonly kind: 'unnamed';
      readonly target: Expression;
      readonly path: readonly TargetStep[];
      readonly type: Type;
    };

/**
 * A node giving a value where one is expected (§4.2): an expression, the `Unit` a bare `return`, or
 * a block with no tail expression, gives, or an array literal's spread, each of whose items fits
 * alike.
 */
export type ValueSite = Expression | Return | Block | Spread;

/** What gives a field: its name, or a call pattern's argument by position (§11.3). */
export type FieldGiver = Identifier | PatternArgument;

/** A construct that runs over an iterable (§8.4): a `for`, a comprehension, or a spread. */
export type Iteration = For | Comprehension | Spread;

/**
 * What a collection literal builds: an `Array`, a `Map`, or a value of another declared type (§3.3).
 */
export type CollectionForm = 'array' | 'map' | 'declared';

/**
 * How an iteration over `item`s runs (§8.2): through the cursor its `iterate` call gives, or, for
 * a spread of the collection its literal builds, an array or a `Map`, copied whole.
 */
export interface IterationForm {
  readonly kind: 'cursor' | 'copied';
  readonly item: Type;
}

/** A field loop's pass as checked: its key and value, and the body as the pass reads it. */
export interface FieldPass extends FieldPassType {
  readonly body: CheckedBody;
}

/** What one body's exits and holds name, as lowering and the flow model read it. */
export interface LabelResolution {
  /** The scope `exit` leaves or goes on with; undefined where the checker found none. */
  readonly exitOf: (exit: Break | Continue) => LabelledScope | undefined;
  /** The labelled loop or block what `hold` holds lasts until; undefined for the function. */
  readonly heldUntil: (hold: Hold) => LabelledScope | undefined;
  /** Whether some `hold` names `scope`, which then keeps a list of what it holds. */
  readonly isHoldScope: (scope: LabelledScope) => boolean;
}

/** A node a body types, and the type it has there, as checked. */
interface MadeType {
  readonly site: NodeOf<string>;
  readonly type: Type;
}

/**
 * What checking a function body found of its nodes, for lowering (architecture: phase contracts).
 * Every fact is one entry of the body's facts table (wiring/body/facts/), which says how it is read
 * as a pass checked it, through an instantiation, and across a field loop's passes.
 */
export interface BodyFacts {
  /** The type of an expression of this body; undefined for one never checked. */
  readonly typeOf: (expression: Expression) => Type | undefined;
  /**
   * The type a type written in this body denotes, as the pass reads it: in a loop over a type's
   * keys, each pass's key bound (§11.2); undefined for one the body never resolved.
   */
  readonly writtenTypeOf: (node: WrittenType) => Type | undefined;
  /**
   * The type expected of the value `site` gives, where its context expects one (§4.2, §11.3): passed
   * down to its check, or fitted to once checked; undefined where nothing is expected.
   */
  readonly expectedOf: (site: ValueSite) => Type | undefined;
  /** The function each call site of this body calls. */
  readonly resolved: PassRecords<ResolvedSite, ResolvedCall>;
  /**
   * The function each naming of one as a value names (§6.4), at the naming itself, `f`, `ns.f`,
   * `T.f` or `f<Int>`: what its closure calls later, nothing where it stands.
   */
  readonly functionValues: PassRecords<FunctionNaming, ResolvedCall>;
  /**
   * The calls of function values, which call whatever their callee gives (§6.4), each with how
   * its arguments fill the value's parameters.
   */
  readonly valueCalls: PassRecords<CallingNode, ValueCallMade>;
  /**
   * Every call the body makes, where it makes it: its call sites', the language's for constructs
   * with no call written (`implicitCallOf`), and the defaults its struct literals leave fields to;
   * and every function it names as a value, which a closure calls later (`functionValues`).
   */
  readonly madeCalls: () => readonly MadeCall[];
  /**
   * Every type the body's values have, nested functions' included, in every pass: each expression's,
   * the type each value is expected to have where it is used, and each name's it declares.
   */
  readonly madeTypes: () => readonly MadeType[];
  /**
   * A call the language makes for the construct `node`, in `role`, with no call written for it
   * (resolution/applying/implicit.ts); undefined for a role the construct doesn't need.
   */
  readonly implicitCallOf: (node: NodeOf<string>, role: ImplicitRole) => ResolvedCall | undefined;
  /** What a collection literal builds (§3.3). */
  readonly collectionFormOf: (literal: ArrayLiteral | MapLiteral) => CollectionForm;
  /** How an iteration runs: through its cursor, or copied whole (§8.4); undefined if never checked. */
  readonly iterationOf: (iteration: Iteration) => IterationForm | undefined;
  /** How the value `site` gives is converted to fit where it is used (§4.2, §8.2, §6.4). */
  readonly fitAt: (site: ValueSite) => Fit;
  /**
   * What the targets of a declaration, or of a loop for each item, bind: each name's part of the
   * value.
   */
  readonly targetsOf: (owner: TargetOwner) => readonly TargetBinding[];
  /** Where an assignment's value goes: each place written, with its part of the value. */
  readonly assignedOf: (assignment: Assignment) => readonly AssignedPart[];
  /**
   * Whether the variable `name` declares lives in a cell: passed by `&` anywhere in the body
   * (§7.3), or a `let` a closure captures (§6.4).
   */
  readonly inCell: (name: Identifier) => boolean;
  /** A lambda or local function of this body, as checked. */
  readonly functionOf: (node: Lambda | FunctionDeclaration) => CheckedFunction | undefined;
  /**
   * Where each field of a struct literal gets its value, in declaration order; undefined for a
   * literal the checker found a mistake in.
   */
  readonly sourcesOf: (literal: FieldsLiteral) => readonly FieldSource[] | undefined;
  /**
   * The fields a struct literal builds, typed by the type arguments found for it,
   * whatever its items give: what may be written in it (§5.2); undefined for a literal never
   * checked against declared fields.
   */
  readonly literalFieldsOf: (literal: FieldsLiteral) => readonly FieldMember[] | undefined;
  /** A `match` case's or `is`'s pattern as checked (§11.3); undefined for one never checked. */
  readonly patternOf: (pattern: Pattern) => CheckedPattern | undefined;
  /**
   * The type of the value a pattern or a part of one is matched against, whole where earlier cases
   * left only some of a union's members (§11.3); undefined for one never walked.
   */
  readonly matchedTypeOf: (node: Pattern | PatternPart) => Type | undefined;
  /**
   * The fields a struct pattern's items or a call pattern's arguments may name: its struct's or its
   * variant's; undefined where the pattern names none (§11.3).
   */
  readonly patternFieldsOf: (pattern: FieldsPattern) => readonly FieldMember[] | undefined;
  /** A link of an optional chain (§10.4), such as `a?.b` or the `.c` of `a?.b.c`; else undefined. */
  readonly chainOf: (link: Expression) => ChainLink | undefined;
  /**
   * How `reading`, `s.name` or `s[k]` by a key, reaches its field; undefined where it reads no
   * field: a name of a namespace or a type, or an element `index` gives.
   */
  readonly fieldReadOf: (reading: FieldReading) => FieldRead | undefined;
  /**
   * The type of a name the body declares: a variable's, a parameter's, or what a loop, a pattern
   * or a `select` case binds; undefined for any other name.
   */
  readonly declaredTypeOf: (name: Identifier) => Type | undefined;
  /**
   * The field `giver` gives: a field's name in a struct literal, a pattern or an assignment's
   * target, or a call pattern's argument by position, an item of the rest field among them (§11.3).
   */
  readonly fieldGivenBy: (giver: FieldGiver) => FieldMember | undefined;
  /** The struct whose key a String literal of this body was checked as (§5.2); else undefined. */
  readonly keyOwnerOf: (literal: StringLiteral) => Type | undefined;
  /**
   * The core tree a sugar was checked as, and the core call a written call it makes was rebuilt as
   * (checker/desugaring/); undefined for any other node, and for a sugar refused.
   */
  readonly coreOf: (node: Expression) => CoreExpression | undefined;
  /** The variant a bare variant name chose by the type expected of it (§5.3). */
  readonly chosenVariantOf: (name: Identifier) => VariantEntity | undefined;
  /** The functions a call site chose among, in the order considered; none where nothing was. */
  readonly candidatesAt: (site: ResolvedSite) => readonly FunctionDeclaration[];
  /** What each `break`, `continue` and `hold(name)` of the body names (§7.1, §11.1). */
  readonly labels: LabelResolution;
  /**
   * The passes the field loop `header` heads was checked in (§11.2), in the order checked: one per
   * field of a known struct, or one per field a struct constraint names and one for the others
   * (passes.ts), which an instantiation knowing them reads as one per field. Each pass reads the
   * body as that pass checked it.
   */
  readonly passesOf: (header: FieldLoopHeader) => readonly FieldPass[];
  /**
   * Whether `body`, a branch or a case, never runs: a condition its operands' types decide rules
   * it out (§11.2), so nothing of it was checked and nothing is lowered.
   */
  readonly isRuledOut: (body: Block) => boolean;
  /**
   * The operands an operation on a value of type `Never` runs before it stops (§4.1); else undefined.
   */
  readonly stopsAt: (operation: Expression | Assignment) => readonly Expression[] | undefined;
  /** The value an `if`'s condition always has, by its operands' types; undefined when not fixed. */
  readonly decidedOf: (condition: Expression) => boolean | undefined;
  /** What the body produces: `T` for an async function returning `Future<T>`. */
  readonly result: Type;
}

/**
 * A type a body writes: a type node, or an expression naming a type where no value is read, a
 * loop's key over a type's keys (§11.2) or a type indexed by one before `.` (§5.2).
 */
export type WrittenType = TypeNode | Expression;

/** What building a body's flow reads of the checker asking for it (rules/flow/build/). */
export type FlowChecker = Pick<
  Checker,
  | 'bindings'
  | 'parametersOf'
  | 'resultOf'
  | 'fieldsOf'
  | 'variantsOf'
  | 'fitOf'
  | 'typeRules'
  | 'wellKnownType'
  | 'blockOf'
>;

/** A checked body: its facts, and the views of it every fact is read through alike. */
export interface CheckedBody extends BodyFacts {
  /**
   * What the body is read through (§8.1, §11.2): an instantiation's type arguments, and in a pass over
   * a field it names, the loop's key as that field's; none for the body as checked.
   */
  readonly substitution: Substitution;
  /**
   * The body as one instantiation reads it (§8.1): checked once, generically, it records types of
   * its type parameters, each substituted here (wiring/body/facts/instantiation.ts).
   */
  readonly instantiated: (
    substitution: Substitution,
    checker: Pick<Checker, 'fieldNamed' | 'typeRules'>,
  ) => CheckedBody;
  /**
   * The body read as one with `others`, the other passes of the field loops around a node (§11.2),
   * as tools read the node (contexts/pass-views.ts); with none, the body alone, as tools read it.
   */
  readonly joinedWith: (others: readonly CheckedBody[], rules: TypeRules) => JoinedBody;
  /**
   * The flow of `root` (flow-ir.ts), one the body was checked from: a function's block, a
   * default's value, a constant's initializer; as this view reads the body, built once per
   * `checker`, the revision asking, against which it is built.
   */
  readonly flowOf: (root: Block | Expression, checker: FlowChecker) => FlowFunction;
  /** The flow of a lambda or local function of the body (§6.4), as this view reads it. */
  readonly nestedFlowOf: (node: NestedFunction, checker: FlowChecker) => FlowFunction;
}
