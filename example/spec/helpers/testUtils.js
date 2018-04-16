const fs = require('fs');
const lodash = require('lodash');
const yaml = require('js-yaml');

/**
 * Loads and parses the configuration defined in `./spec/config.yml` or
 * `./spec/config.override.yml` if it exists.
 *
 * @returns {Object} - Configuration object
*/
function loadConfig() {
  let configFileName = './spec/config.yml';
  const overrideConfigFilename = './spec/config.override.yml';

  if (fs.existsSync(overrideConfigFilename) && !process.env.USE_DEFAULT_CONFIG) {
    configFileName = overrideConfigFilename;
  }
  return yaml.safeLoad(fs.readFileSync(configFileName), 'utf8');
}

/**
 * Creates a new file using a template file and configuration object which
 * defines fields to write to in the input template.
 *
 * @param   {Object} options - Options
 * @param   {string} options.inputTemplateFilename - File path and name of template file (json)
 * @param   {Object} options.config - Object to use to write to fields in the template
 * @returns {string} - File path and name of output file (json)
 */
function templateFile({ inputTemplateFilename, config }) {
  const inputTemplate = JSON.parse(fs.readFileSync(inputTemplateFilename));
  const templatedInput = lodash.merge(lodash.cloneDeep(inputTemplate), config);
  let jsonString = JSON.stringify(templatedInput, null, 2);
  jsonString = jsonString.replace('{{AWS_ACCOUNT_ID}}', process.env.AWS_ACCOUNT_ID);
  const templatedInputFilename = inputTemplateFilename.replace('.template', '');
  fs.writeFileSync(templatedInputFilename, jsonString);
  return templatedInputFilename;
}

module.exports = {
  loadConfig,
  templateFile
};
