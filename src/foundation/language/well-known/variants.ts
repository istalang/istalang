/**
 * The variants and fields the toolchain builds and takes apart by name (§8.4, §8.2, §12): a
 * union's enum, `Result` and `Step`.
 */

/**
 * How a union's enum lays out its values (§4.2, lowering/tables/type-table.ts): a variant per member,
 * named as the member is spelled, so `none`'s is `None`, holding a member's value in its one field.
 */
export const unionLayout = { noneVariant: 'None', valueField: 'value' } as const;

/** The variants of `Result` (§12): `?` passes on an `Err` and takes the `Ok` value. */
export const resultVariants = { ok: 'Ok', err: 'Err' } as const;

/**
 * The variants of `Step` (§8.4): a loop runs its body on a `Next`'s one field, and ends on `Done`.
 */
export const stepVariants = { next: 'Next', done: 'Done' } as const;
