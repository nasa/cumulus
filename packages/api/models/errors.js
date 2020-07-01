'use strict';

class CumulusModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CumulusModelError';
  }
}

module.exports = { CumulusModelError };
