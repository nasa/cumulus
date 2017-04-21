import assert from 'assert';

const local = require('./config/local');
const productionGenerated = require('./config/production-generated');

const configurations = {
  local,
  // This is a generated file. We can add another production file later if desired or needed and
  // merge it together
  productionGenerated,
};
let config = configurations.local;

if (process.env.GIBS_ENV === 'production') {
  config = configurations.productionGenerated;
}

assert(typeof config.apiBaseUrl, 'string');

module.exports = config;
