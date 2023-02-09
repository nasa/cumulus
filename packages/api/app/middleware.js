// @ts-check

'use strict';

const bodyParser = require('body-parser');
const has = require('lodash/has');
const { EcsStartTaskError } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

const { version } = require('../lib/version');
const {
  invalidApiVersion,
  isMinVersionApi,
} = require('../lib/request');

/**
* @typedef { import("../lib/expressTypes").ExpressRequest } Request
* @typedef { import("../lib/expressTypes").BoomResponse } BoomResponse
* @typedef { import("../lib/expressTypes").ExpressNextFunction } NextFunction
*/

const logger = new Logger({ sender: '@cumulus/api' });

// Catch and send the error message down (instead of just 500: internal server error)
// Need all 4 params, because that's how express knows this is the error handler
// eslint-disable-next-line no-unused-vars
const defaultErrorHandler = (error, req, res, next) => {
  logger.error(error);
  return res.boom.badRequest(error.message, error);
};

// eslint-disable-next-line no-unused-vars
const asyncOperationEndpointErrorHandler = (err, req, res, next) => {
  const message = 'Failed to start async operation:';
  logger.error(message, err);
  if (err instanceof EcsStartTaskError) {
    return res.boom.serverUnavailable(`${message} ${err.message}`);
  }
  return res.boom.badImplementation();
};

// https://www.npmjs.com/package/body-parser#errors
const isBodyParserError = (error) =>
  has(error, 'statusCode') && has(error, 'expose');

const handleBodyParserError = (res, error) => {
  res.status(error.statusCode);

  if (error.expose) {
    res.json({ error: error.message });
  } else {
    res.end();
  }
};

/**
 * Validates a request has the 'version' header set to at least the same version as the API
 * @param {Request} req - Express Request Object
 * @param {BoomResponse} res - Express Response Object with Boom middleware
 * @param {NextFunction} next - Express 'next' Function
 * @returns { Express.BoomError } // TODO fix this type
 */
const validateApiVersionCompliance = (req, res, next) => {
  if (!isMinVersionApi(req, version)) {
    return invalidApiVersion(res, version);
  }
  next();
  return undefined;
};

const jsonBodyParser = (req, res, next) => {
  const nextWithErrorHandling = (error) => {
    if (error) {
      if (isBodyParserError(error)) {
        handleBodyParserError(res, error);
      } else {
        next(error);
      }
    } else {
      next();
    }
  };

  // Setting limit to 6 MB which is the AWS lambda limit https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
  bodyParser.json({ limit: '6mb' })(req, res, nextWithErrorHandling);
};

module.exports = {
  asyncOperationEndpointErrorHandler,
  defaultErrorHandler,
  jsonBodyParser,
  validateApiVersionCompliance,
};
