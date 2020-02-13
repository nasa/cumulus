'use strict';

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

module.exports = OAuth2;
