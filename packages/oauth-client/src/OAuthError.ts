export class OAuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);

    this.name = 'OAuthError';
    this.code = code;

    Error.captureStackTrace(this, OAuthError);
  }
}
