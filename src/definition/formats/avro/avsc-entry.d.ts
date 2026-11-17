/**
 * avsc's types-only entry, which loads its `lib/types` alone (no files, services, protocols or
 * containers), typed as the part of the package's own types it exports.
 */

declare module 'avsc/etc/browser/avsc-types.js' {
  import type { Type, types } from 'avsc';

  // biome-ignore lint/style/useNamingConvention: avsc names its export `Type`.
  const avscTypes: { readonly Type: typeof Type; readonly types: typeof types };
  export default avscTypes;
}
