'use strict';

const sinon = require('sinon');

const buildFakeExpressResponse = () => ({
  boom: {
    badImplementation: sinon.fake(),
    badRequest: sinon.fake(),
    conflict: sinon.fake(),
  },
  status: sinon.stub().returnsThis(),
  send: sinon.stub(),
});

module.exports = {
  buildFakeExpressResponse,
};
