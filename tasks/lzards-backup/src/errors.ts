// eslint-disable-next-line max-classes-per-file
export class CollectionNotDefinedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectionNotDefinedError';
    Error.captureStackTrace(this, CollectionNotDefinedError);
  }
}

export class CollectionInvalidRegexpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectionInvalidRegexp';
    Error.captureStackTrace(this, CollectionInvalidRegexpError);
  }
}
export class ChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChecksumError';
    Error.captureStackTrace(this, ChecksumError);
  }
}

export class GetAuthTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GetAuthTokenError';
    Error.captureStackTrace(this, ChecksumError);
  }
}
