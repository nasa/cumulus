'use strict';

const { URL } = require('url');

const buildProviderURL = (provider) => {
  const source = new URL(`${provider.protocol}://${provider.host}`);

  if (provider.protocol !== 's3') source.port = provider.port;

  return source.toString().replace(/\/$/, '');
};

module.exports = {
  buildProviderURL
};
