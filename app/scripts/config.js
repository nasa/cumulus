'use strict';
import assert from 'assert';

let configurations = {
  local: require('./config/local'),
  // This is a generated file. We can add another production file later if desired or needed and
  // merge it together
  productionGenerated: require('./config/production-generated')
};
let config = configurations.local;

if (process.env.GIBS_ENV === 'production') {
  config = configurations.productionGenerated;
}

assert(typeof config.apiBaseUrl, 'string');

module.exports = config;
