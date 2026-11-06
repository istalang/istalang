/**
 * A body as checked (§2–§4), the model check.ts names (`Checker.bodyOf`, `defaultsOf`,
 * `constantBodyOf`): every fact its check recorded of its nodes (`BodyFacts`), so lowering reads
 * exactly what was checked and never re-derives a type, and the records those facts answer with:
 * the functions nested in it and their parameters, where a literal's fields get their values, the
 * parts an assignment writes, an optional chain's links, iterations and labels. body/ records and
 * answers it, per pass of the field loops it holds (passes.ts).
 */

import type { VariableEntity, VariantEntity } from '../../binder/entities.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type {
  ArrayLiteral,
  Call,
  Comprehension,
  Expression,
  FieldHeader,
  FieldsLiteral,
  IndentedValue,
  Lambda,
  MapLiteral,
  Spread,
  StructComprehension,
} from '../../syntax/expressions/index.ts';
import type { BuiltLiteral } from '../../syntax/expressions/literals/indented-values.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import type { Pattern } from '../../syntax/patterns.ts';
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
import type { Identifier, NodeOf } from '../../syntax/tree/node.ts';
import type { Checker, SignatureParameter } from '../check.ts';
import type { FieldPassType, PassRecords } from '../contexts/passes.ts';
import type { Fit } from '../types/fitting/fit.ts';
import type { Substitution } from '../types/parts/substitution.ts';
import type { FieldMember, FunctionType, Type } from '../types/type/index.ts';
import type { TypeRules } from '../types/type/type-rules.ts';
import type { FieldRead, FieldReading } from './checked-field.ts';
import type { CheckedPattern, TargetBinding, TargetOwner, TargetStep } from './checked-pattern.ts';
import type { JoinedBody } from './denotation.ts';
import type {
  FunctionCall,
  ImplicitRole,
  MadeCall,
  ResolvedCall,
  ResolvedSite,
} from './resolved-call.ts';

/**
 * A lambda or local function as checked (§3.14): its type, its parameters as checked, in order,
 * a rest one a pack's (§3.5), and what it captures in the order first used. Lowering makes it a
 * function-table entry of its own.
 */
export interface CheckedFunction {
  readonly type: FunctionType;
  readonly parameters: readonly SignatureParameter[];
  readonly captures: readonly CapturedVariable[];
}

/** A function nested in a body: a lambda, or a local `fn` (a `const` bound to one, §3.14). */
export type NestedFunction = Lambda | FunctionDeclaration;

/** A variable a closure captures, with its type. */
export interface CapturedVariable {
  readonly entity: VariableEntity;
  readonly type: Type;
}

/**
 * Where a struct literal's field, named `field`, gets its value (§3.1): an expression of the
 * literal, the field of that position in its leading spread's value, or its default: `call`'s
 * default for that field, of the function the fields read as, computed from the fields before it
 * (syntax/declarations/field-defaults.ts). A literal's sources come in declaration order, the order
 * evaluation follows; its value takes its type's layout by the fields' names (`laidOut`). A struct
 * comprehension (§3.1) is the source of every field it gives, one per field of the struct each
 * instantiation runs it over, so it names none.
 */
export type FieldSource =
  | ({ readonly field: string } & (
      | { readonly kind: 'value'; readonly value: Expression }
      | { readonly kind: 'spread'; readonly from: Expression; readonly index: number }
      | { readonly kind: 'default'; readonly call: FunctionCall }
    ))
  | { readonly kind: 'comprehension'; readonly comprehension: StructComprehension };

/**
 * A link of an optional chain (§4): the type its own step works on (the value inside, after
 * `?.`), and the value it carries along the chain, which the chain, if it ends at this link,
 * wraps into its `T?` unless it is optional already. An instantiation may make it so (§3.5).
 */
export interface ChainLink {
  readonly base: Type;
  readonly carried: Type;
}

/**
 * How a value written to a place converts to fit it (§2, §3.10, §3.14): as checked, or, where a key
 * that may name several fields reads the place (§3.9), into whichever field the key names, each
 * conversion derived from the field types the instantiation makes concrete. A key of several names
 * in a generic body may name one field once instantiated, which then takes the value as that one
 * field's conversion says.
 */
export type WrittenFit = Fit | 'intoKeyedField';

/**
 * A place an assignment writes, and the part of the assigned value it gets (§3.15): the steps to
 * it in the value (tuple positions and struct fields), its type, and how it is converted to fit
 * the place.
 */
export interface AssignedPart {
  readonly target: Expression;
  readonly path: readonly TargetStep[];
  readonly type: Type;
  readonly fit: WrittenFit;
}

/**
 * A node giving a value where one is expected (§2): an expression, the `Unit` a bare `return`, or
 * a block with no tail expression, gives, or an array literal's spread, each of whose items fits
 * alike.
 */
export type ValueSite = Expression | Return | Block | Spread;

/** A construct that runs over an iterable (§3.10): a `for`, a comprehension, or a spread. */
export type Iteration = For | Comprehension | Spread;

/**
 * What a collection literal builds: an `Array`, a `Map`, or a value of another declared type (§2).
 */
export type CollectionForm = 'array' | 'map' | 'declared';

/**
 * How an iteration runs (§3.10): through the cursor its `iterate` call gives, of `item`s, or, for
 * a spread of the collection its literal builds, an array or a `Map`, copied whole.
 */
export type IterationForm =
  | { readonly kind: 'cursor'; readonly item: Type }
  | { readonly kind: 'copied' };

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

/**
 * What checking a function body found of its nodes, for lowering (architecture: phase contracts).
 * Every fact is one entry of the body's facts table (wiring/body/facts/), which says how it is read
 * as a pass checked it, through an instantiation, and across a field loop's passes.
 */
export interface BodyFacts {
  /** The type of an expression of this body; undefined for one never checked. */
  readonly typeOf: (expression: Expression) => Type | undefined;
  /**
   * The type expected of the value `site` gives, where its context expects one (§2, §3.11): passed
   * down to its check, or fitted to once checked; undefined where nothing is expected.
   */
  readonly expectedOf: (site: ValueSite) => Type | undefined;
  /** The function each call site of this body calls, or each function value names. */
  readonly resolved: PassRecords<ResolvedSite, ResolvedCall>;
  /** The calls of function values, which call whatever their callee gives (§3.14). */
  readonly valueCalls: PassRecords<Call, true>;
  /**
   * Every call the body makes, where it makes it: its call sites', the language's for constructs
   * with no call written (`implicitCallOf`), and the defaults its struct literals leave fields to.
   */
  readonly madeCalls: () => readonly MadeCall[];
  /**
   * A call the language makes for the construct `node`, in `role`, with no call written for it
   * (resolution/applying/implicit.ts); undefined for a role the construct doesn't need.
   */
  readonly implicitCallOf: (node: NodeOf<string>, role: ImplicitRole) => ResolvedCall | undefined;
  /** What a collection literal builds (§2). */
  readonly collectionFormOf: (literal: ArrayLiteral | MapLiteral) => CollectionForm;
  /** How an iteration runs: through its cursor, or copied whole (§3.10). */
  readonly iterationOf: (iteration: Iteration) => IterationForm;
  /** How the value `site` gives is converted to fit where it is used (§2, §3.10, §3.14). */
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
   * (§3.7), or a `let` a closure captures (§3.14).
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
   * The fields a struct or variant literal builds, typed by the type arguments found for it,
   * whatever its items give: what may be written in it (§3.1); undefined for a literal never
   * checked against declared fields.
   */
  readonly literalFieldsOf: (literal: FieldsLiteral) => readonly FieldMember[] | undefined;
  /** A `match` case's or `is`'s pattern as checked (§3.11); undefined for one never checked. */
  readonly patternOf: (pattern: Pattern) => CheckedPattern | undefined;
  /** A link of an optional chain (§4), such as `a?.b` or the `.c` of `a?.b.c`; else undefined. */
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
  /** The field a field's name in a struct literal, a pattern or an assignment's target names. */
  readonly namedFieldOf: (name: Identifier) => FieldMember | undefined;
  /** The struct whose key a String literal of this body was checked as (§3.1); else undefined. */
  readonly keyOwnerOf: (literal: StringLiteral) => Type | undefined;
  /** The literal an indented value was checked as (§2); undefined for one never checked as one. */
  readonly builtLiteralOf: (value: IndentedValue) => BuiltLiteral | undefined;
  /** The variant a bare variant name chose by the type expected of it (§3.11). */
  readonly chosenVariantOf: (name: Identifier) => VariantEntity | undefined;
  /** The functions a call site chose among, in the order considered; none where nothing was. */
  readonly candidatesAt: (site: ResolvedSite) => readonly FunctionDeclaration[];
  /** What each `break`, `continue` and `hold(name)` of the body names (§3.4, §4). */
  readonly labels: LabelResolution;
  /**
   * The passes the field loop `header` heads was checked in (§4), in the order checked: one per
   * field of a known struct, or one per field a struct constraint names and one for the others
   * (passes.ts). Each pass reads the body as that pass checked it.
   */
  readonly passesOf: (header: FieldHeader) => readonly FieldPass[];
  /**
   * Whether `body`, a branch or a case, never runs: a condition its operands' types decide rules
   * it out (§4), so nothing of it was checked and nothing is lowered.
   */
  readonly isRuledOut: (body: Block) => boolean;
  /**
   * The operands an operation on a value of type `Never` runs before it stops (§2); else undefined.
   */
  readonly stopsAt: (operation: Expression | Assignment) => readonly Expression[] | undefined;
  /** The value an `if`'s condition always has, by its operands' types; undefined when not fixed. */
  readonly decidedOf: (condition: Expression) => boolean | undefined;
  /** What the body produces: `T` for an async function returning `Future<T>`. */
  readonly result: Type;
}

/** A checked body: its facts, and the views of it every fact is read through alike. */
export interface CheckedBody extends BodyFacts {
  /**
   * The body as one instantiation reads it (§3.5): checked once, generically, it records types of
   * its type parameters, each substituted here (wiring/body/facts/instantiation.ts).
   */
  readonly instantiated: (
    substitution: Substitution,
    checker: Pick<Checker, 'fieldsOf' | 'typeRules'>,
  ) => CheckedBody;
  /**
   * The body read as one with `others`, the other passes of the field loops around a node (§4),
   * as tools read the node (lookup/pass-views.ts); with none, the body alone, as tools read it.
   */
  readonly joinedWith: (others: readonly CheckedBody[], rules: TypeRules) => JoinedBody;
}
