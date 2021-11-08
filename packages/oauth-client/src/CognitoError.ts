export class CognitoError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);

    this.name = 'CognitoError';
    this.code = code;

    Error.captureStackTrace(this, CognitoError);
  }
}
