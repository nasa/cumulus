/** This method is for parsing a caught error which is not an HTTPerror
 * in case the EDL endpoint call results in an unexpected error
 *
 * @returns {Error}
 */
function parseCaughtError(e: unknown): Error {
  return (e instanceof Error ? e : new Error(`${e}`));
}
export = parseCaughtError;
