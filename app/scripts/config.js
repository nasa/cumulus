/**
 * Provides configuration for the application. Configuration is determined from the environmental
 * setting.
 */
const local = require('./config/local');
const productionGenerated = require('./config/production-generated');

const configurations = {
  local,
  // This is a generated file. We can add another production file later if desired or needed and
  // merge it together
  productionGenerated
};
let config = configurations.local;

// This is updated by envify during compilation and the process.env.GIBS_ENV is replaced with a
// constant
if (process.env.GIBS_ENV === 'production') {
  config = configurations.productionGenerated;
}

module.exports = config;
