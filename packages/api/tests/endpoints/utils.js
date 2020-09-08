'use strict';

const sinon = require('sinon');

const buildFakeExpressResponse = () => ({
  boom: {
    badImplementation: sinon.fake(),
    badRequest: sinon.fake(),
    conflict: sinon.fake(),
  },
  send: sinon.fake(),
});

module.exports = {
  buildFakeExpressResponse,
};
