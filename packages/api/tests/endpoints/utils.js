'use strict';

const sinon = require('sinon');

const buildFakeExpressResponse = () => ({
  boom: {
    badImplementation: sinon.fake(),
    badRequest: sinon.fake(),
    conflict: sinon.fake(),
    notFound: sinon.fake(),
  },
  send: sinon.fake(),
  status: sinon.stub().returns({
    send: sinon.fake(),
  }),
});

module.exports = {
  buildFakeExpressResponse,
};
