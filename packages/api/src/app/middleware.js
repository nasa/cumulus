const { EcsStartTaskError } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

const logger = new Logger({ sender: '@cumulus/api' });

// Catch and send the error message down (instead of just 500: internal server error)
// Need all 4 params, because that's how express knows this is the error handler
// eslint-disable-next-line no-unused-vars
const defaultErrorHandler = (error, req, res, next) => {
  logger.error(error);
  return res.boom.badRequest(error.message, error);
};

// eslint-disable-next-line no-unused-vars
const asyncOperationEndpointErrorHandler = async (err, req, res, next) => {
  const message = 'Failed to start async operation:';
  logger.error(message, err);
  if (err instanceof EcsStartTaskError) {
    return res.boom.serverUnavailable(`${message} ${err.message}`);
  }
  return res.boom.badImplementation();
};

module.exports = {
  asyncOperationEndpointErrorHandler,
  defaultErrorHandler
};
