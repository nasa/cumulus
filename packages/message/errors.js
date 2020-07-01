'use strict';

class CumulusMessageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CumulusMessageError';
    Error.captureStackTrace(this, CumulusMessageError);
  }
}

module.exports = { CumulusMessageError };
