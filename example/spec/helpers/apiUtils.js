const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

const distributionApiStatusPath = path.join(__dirname, 'distributionApiStatus.json');

function setDistributionApiEnvVars() {
  process.env.PORT = 5002;
  process.env.DISTRIBUTION_REDIRECT_ENDPOINT = `http://localhost:${process.env.PORT}/redirect`;
  process.env.DISTRIBUTION_ENDPOINT = `http://localhost:${process.env.PORT}`;
  // Ensure integration tests use Earthdata login UAT if not specified.
  if (!process.env.EARTHDATA_BASE_URL) {
    process.env.EARTHDATA_BASE_URL = 'https://uat.urs.earthdata.nasa.gov';
  }
}

async function startDistributionApi(testId, done) {
  if (!fs.existsSync(distributionApiStatusPath)) {
    fs.outputJSONSync(distributionApiStatusPath, { listeners: [] });
  }

  const distributionApiStatus = fs.readJsonSync(distributionApiStatusPath);

  const listeners = [
    ...distributionApiStatus.listeners,
    testId
  ];

  if (distributionApiStatus.listeners.length === 0) {
    const distApiProcess = spawn('node', ['./scripts/start-distribution-API.js'], {
      env: process.env
    });

    fs.outputJSONSync(distributionApiStatusPath, {
      pid: distApiProcess.pid,
      listeners
    });

    return done();
  }

  fs.outputJSONSync(distributionApiStatusPath, {
    ...distributionApiStatus,
    listeners
  });
  console.log('Distribution API already running');
  return done();
}

async function stopDistributionApi(testId, done) {
  const distributionApiStatus = fs.readJsonSync(distributionApiStatusPath);

  const listeners = distributionApiStatus.listeners
    .filter((listener) => listener !== testId);

  if (listeners.length === 0) {
    process.kill(distributionApiStatus.pid);
    fs.outputJSONSync(distributionApiStatusPath, {
      listeners
    });
    return done();
  }

  fs.outputJSONSync(distributionApiStatusPath, {
    ...distributionApiStatus,
    listeners
  });
  console.log(`Distribution API still in use by ${testId}, continuing`);
  return done();
}

module.exports = {
  setDistributionApiEnvVars,
  startDistributionApi,
  stopDistributionApi
};
