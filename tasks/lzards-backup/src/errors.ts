// eslint-disable-next-line max-classes-per-file
export class CollectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectionNotDefinedError';
    Error.captureStackTrace(this, CollectionError);
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
