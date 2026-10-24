/**
 * Errors the operating system raised, which Node marks with an errno and its code (`ENOENT`,
 * `EACCES`, `ENOTDIR`). Every CLI module that touches the file system tells them apart through
 * here, so what counts as a system error is decided once.
 */

/** An error the operating system raised. */
export type SystemError = Error & { readonly errno: number; readonly code: string };

export function isSystemError(error: unknown): error is SystemError {
  return (
    error instanceof Error && 'errno' in error && 'code' in error && typeof error.code === 'string'
  );
}
