'use strict';

const isString = require('lodash.isstring');

function objectHasCaseInsensitiveKey(obj, key) {
  const lowercaseKey = key.toLowerCase();

  const allKeys = Object.keys(obj);
  const allLowercaseKeys = allKeys.map((k) => k.toLowerCase());

  return allLowercaseKeys.includes(lowercaseKey);
}

/**
 * An API Gateway response for an endpoint using Lambda Proxy integration.
 *
 * See: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-output-format
 */
class LambdaProxyResponse {
  /**
   * @param {Object} params
   * @param {boolean} [params.json=false] - If true, will set the Content-Type
   *   header to 'application/json' and will convert the body argument to a JSON
   *   string. If the json argument is set to true and the caller specifies a
   *   Content-Type in the headers argument, that specified headers argument
   *   will not be overwritten.
   * @param {string} params.body - The body of the response.  If json is set to
   *   true, must be a plain Javascript Object or an Array.  If json is set to
   *   false, must be a string.
   * @param {Object} [params.headers={}] - Headers to set on the response.  In
   *   addition to the specified headers, the 'Access-Control-Allow-Origin'
   *   header will always be set to '*' and the 'Strict-Transport-Security'
   *   header will always be set to 'max-age=31536000'.
   * @param {integer} [params.statusCode=200] - The status code of the response.
   */
  constructor(params = {}) {
    this._body = params.body;
    this._customHeaders = params.headers || {};
    this._json = params.json || false;
    this._statusCode = params.statusCode || 200;

    if (this._json && isString(this._body)) {
      throw new TypeError('body must be an Object or Array when json is true');
    }
  }

  get statusCode() {
    return this._statusCode;
  }

  get headers() {
    const requiredHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Strict-Transport-Security': 'max-age=31536000'
    };
    const headers = Object.assign({}, this._customHeaders, requiredHeaders);

    if (this._json) {
      if (!objectHasCaseInsensitiveKey(headers, 'Content-Type')) {
        headers['Content-Type'] = 'application/json';
      }
    }

    return headers;
  }

  get body() {
    if (this._json) {
      return JSON.stringify(this._body);
    }

    return this._body;
  }
}
exports.LambdaProxyResponse = LambdaProxyResponse;

class AuthorizationFailureResponse extends LambdaProxyResponse {
  constructor(params = {}) {
    const {
      error,
      message,
      statusCode = 401
    } = params;

    let wwwAuthenticateValue = 'Bearer';
    if (error) {
      wwwAuthenticateValue = `Bearer error="${error}", error_description="${message}"`;
    }

    super({
      statusCode,
      json: true,
      headers: { 'WWW-Authenticate': wwwAuthenticateValue },
      body: { message }
    });
  }
}
exports.AuthorizationFailureResponse = AuthorizationFailureResponse;

class NotFoundResponse extends LambdaProxyResponse {
  constructor() {
    super({ statusCode: 404 });
  }
}
exports.NotFoundResponse = NotFoundResponse;

class InternalServerError extends LambdaProxyResponse {
  constructor() {
    super({
      json: true,
      statusCode: 500,
      body: { message: 'Internal Server Error' }
    });
  }
}
exports.InternalServerError = InternalServerError;
