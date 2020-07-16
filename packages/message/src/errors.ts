'use strict';

export class CumulusMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CumulusMessageError';
    Error.captureStackTrace(this, CumulusMessageError);
  }
}
