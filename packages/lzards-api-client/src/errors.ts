// eslint-disable-next-line max-classes-per-file
export class GetAuthTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GetAuthTokenError';
    Error.captureStackTrace(this, GetAuthTokenError);
  }
}
