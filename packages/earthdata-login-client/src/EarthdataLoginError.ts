export class EarthdataLoginError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);

    this.name = 'EarthdataLoginError';
    this.code = code;

    Error.captureStackTrace(this, EarthdataLoginError);
  }
}
