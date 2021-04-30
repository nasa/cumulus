export class OAuthLoginError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);

    this.name = 'OAuthLoginError';
    this.code = code;

    Error.captureStackTrace(this, OAuthLoginError);
  }
}
