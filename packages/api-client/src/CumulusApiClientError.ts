export class CumulusApiClientError extends Error {
  public statusCode: number | undefined;
  public apiMessage: string | undefined;

  constructor(message: string, statusCode: number, apiMessage: string | undefined) {
    super("CumulusApiClientError: " + message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.apiMessage = apiMessage;
  }
}

export default CumulusApiClientError;
