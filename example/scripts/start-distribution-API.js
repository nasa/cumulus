'use strict';

const { serveDistributionApi } = require('@cumulus/api/bin/serve');

if (!process.env.DEPLOYMENT) {
  console.error('DEPLOYMENT env var must be set');
}

serveDistributionApi(process.env.DEPLOYMENT);
