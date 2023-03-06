/**
 * This method is for parsing a caught error which is not an HTTPerror
 * in case the EDL endpoint call results in an unexpected error
 *
 * @param {unkown} e - the Error, if e isn't of type Error then it returns itself
 * @returns {Error}
 */
export const parseCaughtError = (e: unknown): Error =>
  (e instanceof Error ? e : new Error(`${e}`));
