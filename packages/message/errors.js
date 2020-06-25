'use strict';

class CumulusMessageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CumulusMessageError';
  }
}

module.exports = { CumulusMessageError };
