/**
 * The flow IR (§2–§8): a checked body as the code runs, a control-flow graph of explicit value
 * operations over the body's variables and temporaries, derived from what checking recorded
 * (CheckedBody) and nothing else. Rules over the order code runs in and where values go read it
 * (../rules/flow/build/ derives it; ../rules/flow/solve.ts runs a rule forward over it).
 *
 * - **Semantics, not layout.** Calls stay as checked, generic: a call's type arguments may name
 *   the body's own type parameters, and a requirement call stays open, closed per instantiation by
 *   whoever reads it (surface/witness-closing.ts). No register, offset or instance-specific shape.
 * - **Every value has a home and a site.** A name the body declares is a variable, one value for
 *   the whole function; anything else computed is a temporary of the node computing it, so a rule
 *   reports at the node. A name of a top-level constant, extern or context constant is a global.
 * - **A use of a variable is a copy out of it at the name** (`copy` from a variable, its site the
 *   name), and a place passed by `&` or written names its variable as its root; any operation
 *   writing into a variable assigns it whole or declares it, which ends what it held.
 * - **A nested function is a function of its own,** made where the body makes its closure from
 *   the values it captures: a lambda's or local `fn`'s captured variables. A local `fn` is made
 *   where it is declared.
 * - **Code no path reaches is kept,** in blocks nothing jumps to, so every construct the text holds
 *   is in the graph; code checking ruled out (§4) was never checked, and is left out.
 * - **Releases** are where the code releases, which lowering writes as said (lowering/flow/): a block
 *   releases its variables at its end and where an exit leaves it, keeping first what its `hold`s
 *   keep, which the scope a `hold` names releases where it ends; `drop` releases its variable; a
 *   statement releases its temporaries at its end, a header (a condition, a guard, a `match`'s
 *   subject) on each path out of it, a block the temporaries of its value but that value. A
 *   `return` releases everything, a function's own block included. Assigning a variable ends what
 *   it held, with no operation of its own.
 */

import { memo } from '../../../foundation/structures/memo.ts';
import type { VariableEntity } from '../../binder/entities.ts';
import type { Expression, FieldLoopHeader, Select } from '../../syntax/expressions/index.ts';
import type { Relation } from '../../syntax/expressions/operators.ts';
import type { LabelledScope } from '../../syntax/statements/index.ts';
import type { SyntaxNode } from '../../syntax/tree/index.ts';
import type { Identifier, NodeOf } from '../../syntax/tree/node.ts';
import type { Type } from '../types/type/index.ts';
import type { WrittenFit } from './checked-body.ts';
import type { RequiredField } from './checked-field.ts';
import type { PartStep, TypeTest } from './checked-pattern.ts';
import type { ConstantForm } from './constant-form.ts';
import type { ImplicitRole, ResolvedCall } from './resolved-call.ts';

/** A value of a flow function, by its position in `FlowFunction.values`. */
export type ValueId = number;

/** A block of a flow function, by its position in `FlowFunction.blocks`; the entry is 0. */
export type BlockId = number;

/**
 * What a value is: a variable the body declares (a parameter, a name a pattern or a loop binds, a
 * local function), named by its declaring name and living in a cell when checking says so; a
 * top-level constant, extern constant or context constant; or a temporary, the value of `site`.
 * A type is undefined where checking recorded none, in code it found a mistake in.
 */
export type FlowValue =
  | {
      readonly kind: 'variable';
      readonly entity: VariableEntity;
      readonly type: Type | undefined;
      readonly inCell: boolean;
    }
  | { readonly kind: 'global'; readonly entity: VariableEntity; readonly type: Type | undefined }
  | { readonly kind: 'temporary'; readonly site: NodeOf<string>; readonly type: Type | undefined };

/**
 * A part of a value an operation reads or a place reaches: a part a pattern or a target reads
 * (`PartStep`: a tuple element by position, a field by name, a variant's field, a union's member,
 * an array's items), the value behind a handle (`*x`, `x->f`), the value inside an optional where
 * it isn't `none` (§4), what a future gives once it has settled (§8), the field `key`, a key of
 * several names, names, the field a trait requires of a value of `on`, whose own type meets it with
 * a field it stores or a getter (§3.10): on an `any` value read through its dispatch, on a type
 * known only per instantiation as each instantiation reads it; or the next item of an array or
 * `Map` being built, which a write appends.
 */
export type Part =
  | { readonly kind: 'step'; readonly step: PartStep }
  | { readonly kind: 'required'; readonly on: Type; readonly required: RequiredField }
  | { readonly kind: 'behind' }
  | { readonly kind: 'inside' }
  | { readonly kind: 'given' }
  | { readonly kind: 'keyed'; readonly key: ValueId }
  | { readonly kind: 'item' };

/** A place, as an assignment writes it or `&` passes it: a value, and the parts into it. */
export interface Place {
  readonly root: ValueId;
  readonly path: readonly Part[];
  /** The expression naming the place; its root's name, where a variable is its root. */
  readonly site: Expression;
  readonly name: Identifier | undefined;
}

/** What a call passes for one of its parameters: a value, or a place by `&`. */
export type Argument =
  | { readonly kind: 'value'; readonly value: ValueId }
  | { readonly kind: 'place'; readonly place: Place };

/**
 * What a `make` makes, of its parts in order: a struct, each part the field `fields` names (a
 * literal's in declaration order, then a comprehension's, one per pass, none for a pass visiting
 * no field), put behind a new handle by `new S{…}`; a tuple; an array of its items, a `Map` of its
 * entries' keys and values, either holding every item of the collections at `spreads` among them
 * (§3.3); the `variant`-th variant of the enum `type` (its fields in order); a closure of a nested
 * function and the values it captures; or a function named as a value, which `call` runs.
 */
type Made =
  | { readonly kind: 'struct' | 'handle'; readonly fields: readonly (string | undefined)[] }
  | { readonly kind: 'tuple' }
  | { readonly kind: 'array' | 'map'; readonly spreads: readonly number[] }
  | { readonly kind: 'variant'; readonly type: Type; readonly variant: number }
  | { readonly kind: 'closure'; readonly function: FlowFunction }
  | { readonly kind: 'function'; readonly call: ResolvedCall };

/**
 * What a `compute` computes, of its operands: a constant (a literal, `Unit`, an offset, a condition
 * checking decided), the built-in `==` of two, `!=` `negated`, `not` of a `Bool`, whether a
 * `compare`'s result is in `relation`, or the one value its type holds (`typeValue`): a member
 * parameter over literal types, one literal per instantiation (§3.5), named as a value, or a field
 * loop's key in its pass over the fields not known yet, the name of each field it visits (§4).
 */
export type Computation =
  | { readonly kind: 'constant'; readonly form: ConstantForm }
  | { readonly kind: 'equal'; readonly negated: boolean }
  | { readonly kind: 'not' }
  | { readonly kind: 'order'; readonly relation: Relation }
  | { readonly kind: 'typeValue' };

/**
 * An operation, at the node it runs for.
 *
 * - `compute`: a value the language computes from its operands, holding none of them
 *   (`Computation`).
 * - `make`: a value holding `parts` (`Made`).
 * - `copy`: `from` bound to `into`, converted as `fit` says where checking fitted it to `into`'s
 *   type; into whichever field a key naming several gives (`intoKeyedField`), each field's own way,
 *   `into` of the type of the place the key names.
 * - `read`: a part of `from`.
 * - `write`: `value` written into the part `place` reaches; into an array's or a `Map`'s `item`,
 *   appended to it.
 * - `call`: a resolved call, written or implicit (`role`), its arguments by value or by `&`.
 * - `callValue`: a call of a function value, its arguments in its parameters' order, those at
 *   `spreads` a pack's tuple spread as its elements (§3.5).
 * - `suspend`: an `await` or an awaiting `select`, waiting until one of the futures it awaits
 *   settles; what each gives is read from it (`given`).
 * - `keep`: what `values` hold, kept past the scope ending here until `until` ends (§7).
 * - `release`: the end of values: a scope's variables, a construct's temporaries, or a `drop`'s.
 * - `unknown`: code checking found a mistake in: its operands run, and what it gives is unknown.
 */
export type Operation = { readonly site: NodeOf<string> } & (
  | {
      readonly op: 'compute';
      readonly into: ValueId;
      readonly computation: Computation;
      readonly operands: readonly ValueId[];
    }
  | {
      readonly op: 'make';
      readonly into: ValueId;
      readonly made: Made;
      readonly parts: readonly ValueId[];
    }
  | {
      readonly op: 'copy';
      readonly into: ValueId;
      readonly from: ValueId;
      readonly fit: WrittenFit | undefined;
    }
  | { readonly op: 'read'; readonly into: ValueId; readonly from: ValueId; readonly part: Part }
  | { readonly op: 'write'; readonly place: Place; readonly value: ValueId }
  | {
      readonly op: 'call';
      readonly into: ValueId;
      readonly call: ResolvedCall;
      readonly role: ImplicitRole | undefined;
      readonly arguments: readonly Argument[];
    }
  | {
      readonly op: 'callValue';
      readonly into: ValueId;
      readonly callee: ValueId;
      readonly arguments: readonly Argument[];
      readonly spreads: readonly number[];
    }
  | { readonly op: 'suspend'; readonly awaited: readonly ValueId[] }
  | {
      readonly op: 'keep';
      readonly values: readonly ValueId[];
      readonly until: LabelledScope | 'function';
    }
  | {
      readonly op: 'release';
      readonly values: readonly ValueId[];
      readonly reason: 'end' | 'drop';
    }
  | { readonly op: 'unknown'; readonly into: ValueId; readonly operands: readonly ValueId[] }
);

/**
 * What a branch tests, which says what each block it goes to is for:
 *
 * - `condition`: a `Bool`, going to `[true, false]`.
 * - `present`: whether an optional holds a value (§4), going to `[present, none]`.
 * - `is`: whether a value holds what `test` asks, going to `[holds, fails]`.
 * - `fieldPass`: the top of the field loop `header` heads (§4), going past the loop, then to each
 *   pass `passesOf(header)` gives, in its order, the field each visits in `fields` (none for the
 *   pass of the fields not known yet, or of no field); each pass runs once per field it visits,
 *   an instantiation's in field order (§3.1).
 * - `select`: which of a `select`'s cases goes on (§8), going to each case's, then to its `else`;
 *   each case `holds` the temporaries its awaitable computed, which it releases where it loses,
 *   and the scope around the `select` releases where it doesn't.
 * - `transient`: whether a call this one is nested in, of the same function, shares its transient
 *   `variable` (§3.4), going to `[shared, unmade]`: where it does, `variable` holds that call's
 *   value, which no operation of this function wrote; where it doesn't, the declaration's
 *   initializer makes it.
 * - `unknown`: a test checking found a mistake in, which may go either way.
 */
export type BranchTest =
  | { readonly kind: 'condition' | 'present'; readonly value: ValueId }
  | { readonly kind: 'is'; readonly value: ValueId; readonly test: TypeTest }
  | {
      readonly kind: 'fieldPass';
      readonly header: FieldLoopHeader;
      readonly fields: readonly (string | undefined)[];
    }
  | {
      readonly kind: 'select';
      readonly node: Select;
      readonly holds: readonly (readonly ValueId[])[];
    }
  | { readonly kind: 'transient'; readonly variable: ValueId }
  | { readonly kind: 'unknown' };

/**
 * How a block ends: going on to one block, to one of several as `test` decides, returning `value`
 * from the function, or stopping, where no path goes on (a `panic`, a value of `Never`).
 */
export type Exit =
  | { readonly kind: 'goto'; readonly to: BlockId }
  | { readonly kind: 'branch'; readonly test: BranchTest; readonly to: readonly BlockId[] }
  | { readonly kind: 'return'; readonly value: ValueId | undefined; readonly site: NodeOf<string> }
  | { readonly kind: 'stop' };

export interface FlowBlock {
  readonly operations: readonly Operation[];
  readonly exit: Exit;
}

/**
 * A function's flow: its body's root, the values it takes as arguments and captures, in order,
 * the variable its own name is inside it (a local `fn`'s or a named lambda's: the closure it runs
 * as, §3.14), every value it names, and its blocks, the entry first.
 */
export interface FlowFunction {
  readonly root: SyntaxNode;
  readonly parameters: readonly ValueId[];
  readonly captures: readonly ValueId[];
  readonly self: ValueId | undefined;
  readonly values: readonly FlowValue[];
  readonly blocks: readonly FlowBlock[];
}

const transientVariables = new WeakMap<FlowFunction, readonly ValueId[]>();

/** The transients `flow` declares (§3.4): the variables its `transient` branches test. */
export function transientsOf(flow: FlowFunction): readonly ValueId[] {
  return memo(transientVariables, flow, () =>
    flow.blocks.flatMap(({ exit }) =>
      exit.kind === 'branch' && exit.test.kind === 'transient' ? [exit.test.variable] : [],
    ),
  );
}

/** The blocks `exit` goes on to. */
export function successorsOf(exit: Exit): readonly BlockId[] {
  if (exit.kind === 'goto') {
    return [exit.to];
  }
  return exit.kind === 'branch' ? exit.to : [];
}

/** The values `operation` reads: its operands, and the keys a part it reads or a place names. */
export function valuesReadBy(operation: Operation): readonly ValueId[] {
  const placeValues = ({ root, path }: Place) => [root, ...path.flatMap(keyOf)];
  const argumentValues = (each: Argument) =>
    each.kind === 'value' ? [each.value] : placeValues(each.place);
  switch (operation.op) {
    case 'compute':
    case 'unknown':
      return operation.operands;
    case 'make':
      return operation.parts;
    case 'copy':
      return [operation.from];
    case 'read':
      return [operation.from, ...keyOf(operation.part)];
    case 'write':
      return [...placeValues(operation.place), operation.value];
    case 'call':
      return operation.arguments.flatMap(argumentValues);
    case 'callValue':
      return [operation.callee, ...operation.arguments.flatMap(argumentValues)];
    case 'suspend':
      return operation.awaited;
    case 'keep':
    case 'release':
      return operation.values;
    default: {
      const unhandled: never = operation;
      return unhandled;
    }
  }
}

/** The key `part` is read by, if it is a field a key of several names names. */
function keyOf(part: Part): readonly ValueId[] {
  return part.kind === 'keyed' ? [part.key] : [];
}
