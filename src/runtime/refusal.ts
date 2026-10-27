/**
 * The runtime refusing what a host asked of it, as opposed to failing: a Definition naming externs
 * no native implements, a value with no JSON form, JSON from the host that doesn't fit the type it
 * was given for (§9), an instance the store doesn't hold or already holds, an operation its
 * status doesn't allow (filling a panicked one, retrying one that hasn't panicked), a snapshot whose
 * Definition the store lacks, a snapshot that doesn't fit its Definition, or a seed of the wrong
 * length from the host's `seed` seam. A host catches these, together with the FormatError an invalid or unknown-version
 * text raises (definition/format.ts), and reports them as the request failing. Anything else the
 * runtime throws is a bug, and propagates with its stack.
 */

export type RefusalReason =
  | 'missingNatives'
  | 'noJsonForm'
  | 'unfitJson'
  | 'panicked'
  | 'notPanicked'
  | 'reservedName'
  | 'externChanged'
  | 'notStartable'
  | 'unknownInstance'
  | 'instanceExists'
  | 'unknownDefinition'
  | 'snapshotMismatch'
  | 'unfitSeed';

export class Refusal extends Error {
  override readonly name = 'Refusal';
  readonly reason: RefusalReason;

  constructor(reason: RefusalReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.reason = reason;
  }
}
