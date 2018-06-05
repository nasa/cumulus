'use strict';

const formidable = require('formidable');
const http = require('http');
const { URL } = require('url');
const { randomString } = require('./test-utils');

// This class runs a simulated Earthdata Login server
class FakeEarthdataLoginServer extends http.Server {
  constructor() {
    super();

    this.usernamesByCode = {};

    this.on('request', (request, response) => {
      const requestUrl = new URL(request.url, this.endpoint);

      if (request.method === 'POST' && requestUrl.pathname === '/oauth/token') {
        this.handleAccessTokenRequest(request, response);
      }
      else {
        response.statusCode = 404;
        response.end();
      }
    });
  }

  /**
   * Create an authorization code for the given user.
   *
   * This is the code that's returned after the user successfully authenticates
   * against the Earthdata Login service and is redirected back to Cumulus.
   *
   * @param {string} username - username to create the code for
   * @returns {string} the authorization code
   */
  createAuthorizationCodeForUser(username) {
    const code = randomString();
    this.usernamesByCode[code] = username;
    return code;
  }

  /**
   * Start the fake Onearth Login server on a random port
   *
   * @param {function} cb - The callback that's called when the server is listening
   * @returns {undefined} no return value
   */
  listen(cb) {
    super.listen(0, '0.0.0.0', cb);
  }

  /**
   * Get the URL where the fake Earthdata Login service is listening
   *
   * @returns {string} - a URL
   * @readonly
   * @memberof FakeEarthdataLoginServer
   */
  get endpoint() {
    const { address, port } = this.address();
    return `http://${address}:${port}/`;
  }

  // @private
  handleAccessTokenRequest(request, response) {
    const form = new formidable.IncomingForm();
    form.parse(request, (err, fields) => {
      if (!fields.code) {
        response.statusCode = 400;
        return response.end(JSON.stringify({ error: '"code" not set' }));
      }

      const username = this.usernamesByCode[fields.code];
      if (!username) {
        response.statusCode = 404;
        return response.end(JSON.stringify({ error: `No user found for code ${fields.code}` }));
      }

      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({
        access_token: 'abc123',
        token_type: 'Bearer',
        expires_in: 123,
        refresh_token: 'asdf1234',
        endpoint: `/api/users/${username}`
      }));
    });
  }
}
module.exports = FakeEarthdataLoginServer;
