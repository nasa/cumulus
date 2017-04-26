'use strict';

/*eslint no-console: ["error", { allow: ["warn", "error"] }] */

/**
 * BadRequestError - Defines a custom error type to signal a bad request.
 *
 * @param message The message to return to the user.
 */
class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/**
 * Provides API handling of errors.
 * The fourth argument is unused but required in order for express to detect this is an error
 * handler.
 */
const handleError = (err, req, res, _next) => {
  if (err.name === 'BadRequestError') {
    res.status(400).json({ errors: [err.message] });
  }
  else {
    console.error(err.stack);
    res.status(500).json({ errors: ['An internal error has occured.'] });
  }
};

export { BadRequestError, handleError };
