//@ts-check

/**
 * @typedef {import('express-boom')} BoomError
 * @typedef {import('../src/zod-utils').BetterZodError} BetterZodError
 */
/**
* @param {import('express').Response<any, Record<string, any>>} res - express response object
* @param {BetterZodError} zodError
* @returns {Express.BoomError} the promise of express response object
*/
const returnCustomValidationErrors = (res, zodError) => {
  if (zodError.errors.filter((error) => error.match('forceRemoveFromCmr')).length > 0) {
    return res.boom.badRequest('forceRemoveFromCmr must be a boolean value');
  }
  return res.boom.badRequest('invalid payload', zodError);
};

module.exports = {
  returnCustomValidationErrors,
};
