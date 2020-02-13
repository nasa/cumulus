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

module.exports = OAuth2AuthenticationError;
