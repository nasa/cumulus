'use strict';

/**
 * Thrown if there is an error that is not caused by bad user credentials.
 * For example, getting an internal server error back from the OAuth2 server
 * would result in an OAuth2AuthenticationError error being thrown.
 */
class OAuth2AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}
exports.OAuth2AuthenticationError = OAuth2AuthenticationError;

/**
 * Thrown if there is a problem with the user's credentials.  For example,
 * trying to get an access token with an expired authorization code would result
 * in an OAuth2AuthenticationFailure being thrown.
 */
class OAuth2AuthenticationFailure extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}
exports.OAuth2AuthenticationFailure = OAuth2AuthenticationFailure;

/**
 * The minimum set of methods that an OAuth 2 class must support
 * @interface
 */
class OAuth2 {
  getAuthorizationUrl() {
    throw new Error('Not implemented');
  }

  async getAccessToken() {
    throw new Error('Not implemented');
  }
}
exports.OAuth2 = OAuth2;
