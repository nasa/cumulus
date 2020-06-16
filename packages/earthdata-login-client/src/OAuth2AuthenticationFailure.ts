/**
 * Thrown if there is a problem with the user's credentials.  For example,
 * trying to get an access token with an expired authorization code would result
 * in an OAuth2AuthenticationFailure being thrown.
 */
export class OAuth2AuthenticationFailure extends Error {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
