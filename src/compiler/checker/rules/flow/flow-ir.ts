/**
 * The flow IR (§2–§8): a checked body as the code runs, a control-flow graph of explicit value
 * operations over the body's variables and temporaries, derived from what checking recorded
 * (CheckedBody) and nothing else. Rules over the order code runs in and where values go read it
 * (build/ derives it; solve.ts runs a rule forward over it).
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
 *   the values it captures: a lambda's or local `fn`'s captured variables, a deferred call's
 *   copies of what it computes now. A local `fn` is made where it is declared.
 * - **Code no path reaches is kept,** in blocks nothing jumps to, so every construct the text holds
 *   is in the graph; code checking ruled out (§4) was never checked, and is left out.
 * - **Releases:** a block releases its variables at its end and where an exit leaves it, a `hold`'s
 *   at the end of the scope it names; `drop` releases its variable; a `return` releases everything.
 *   A temporary ends with the statement it was computed in, and assigning a variable ends what it
 *   held, with no operation of their own.
 */

import type { VariableEntity } from '../../../binder/entities.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { SyntaxNode } from '../../../syntax/tree/index.ts';
import type { Identifier, NodeOf } from '../../../syntax/tree/node.ts';
import type { PartStep } from '../../surface/checked-pattern.ts';
import type { ImplicitRole, ResolvedCall } from '../../surface/resolved-call.ts';
import type { Fit } from '../../types/fitting/fit/index.ts';
import type { Type } from '../../types/type/index.ts';

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
 * (`PartStep`: a tuple element by position, a field by name, a union's member, an array's items),
 * the value behind a handle (`*x`, `x->f`), the value inside an optional where it isn't `none`
 * (§4), what a future gives once it has settled (§8), a field a key of several names reads, or an
 * item a cursor, a copied collection or a comprehension's result holds.
 */
export type Part =
  | { readonly kind: 'step'; readonly step: PartStep }
  | { readonly kind: 'behind' }
  | { readonly kind: 'inside' }
  | { readonly kind: 'given' }
  | { readonly kind: 'keyed' }
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
 * What a `make` makes, of its parts in order: a struct (a literal's fields in declaration order),
 * a tuple, an array, a `Map`, a struct put behind a new handle (`new S{…}`), a closure of a
 * nested function and the values it captures, or a function named as a value, which `call` runs.
 */
type Made =
  | { readonly kind: 'struct' | 'tuple' | 'array' | 'map' | 'handle' }
  | { readonly kind: 'closure'; readonly function: FlowFunction }
  | { readonly kind: 'function'; readonly call: ResolvedCall };

/**
 * An operation, at the node it runs for.
 *
 * - `compute`: a value the language computes from its operands, holding none of them: a literal,
 *   arithmetic, a comparison, a test.
 * - `make`: a value holding `parts` (`Made`).
 * - `copy`: `from` bound to `into`, converted as `fit` says where checking fitted it to `into`'s
 *   type.
 * - `read`: a part of `from`.
 * - `write`: `value` written into the part `place` reaches.
 * - `call`: a resolved call, written or implicit (`role`), its arguments by value or by `&`.
 * - `callValue`: a call of a function value.
 * - `suspend`: an `await` or an awaiting `select`, waiting until one of the futures it awaits
 *   settles; what each gives is read from it (`given`).
 * - `release`: the end of variables, at a scope's end or a `drop`.
 * - `unknown`: code checking found a mistake in: its operands run, and what it gives is unknown.
 */
export type Operation = { readonly site: NodeOf<string> } & (
  | { readonly op: 'compute'; readonly into: ValueId; readonly operands: readonly ValueId[] }
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
      readonly fit: Fit | undefined;
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
    }
  | { readonly op: 'suspend'; readonly awaited: readonly ValueId[] }
  | {
      readonly op: 'release';
      readonly values: readonly ValueId[];
      readonly reason: 'scope' | 'drop';
    }
  | { readonly op: 'unknown'; readonly into: ValueId; readonly operands: readonly ValueId[] }
);

/**
 * How a block ends: going on to one block, to any of several (a test, a loop's top), returning
 * `value` from the function, or stopping, where no path goes on (a `panic`, a value of `Never`).
 */
export type Exit =
  | { readonly kind: 'goto'; readonly to: BlockId }
  | { readonly kind: 'branch'; readonly to: readonly BlockId[] }
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
