'use strict';

const { serveDistributionApi } = require('@cumulus/api/bin/serve');

if (!process.env.DEPLOYMENT) {
  // eslint-disable-next-line no-console
  console.error('DEPLOYMENT env var must be set');
}

serveDistributionApi(process.env.DEPLOYMENT);
