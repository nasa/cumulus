'use strict';

class CumulusLockError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    this.code = this.name;
  }
}

module.exports = CumulusLockError;
