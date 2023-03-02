/**
 * This method is for parsing a caught error which is not an HTTPerror
 * in case the EDL endpoint call results in an unexpected error
 *
 * @returns {Error}
 */
export const parseCaughtError = (e: unknown): Error =>
  (e instanceof Error ? e : new Error(`${e}`));
