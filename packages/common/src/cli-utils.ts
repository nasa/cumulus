/* eslint no-console: "off" */

import kebabCase from 'lodash/kebabCase';

/**
 * Find missing required parameters from cli commander command
 *
 * @param {Object} command - commander command
 * @param {Array<string>} requiredOptions - option names
 * @returns {Array<string>} - required options not present in command
 */
export function findMissingOptions(
  command: { [key: string]: unknown },
  requiredOptions: string[]
) {
  return requiredOptions.filter((param) => !command[param]);
}

/**
 * Convert option name to kebab case for display
 *
 * @param {string} optionName - name of option
 * @returns {string} - display name
 */
function convertCamelOptionToLongOption(optionName: string) {
  return `--${kebabCase(optionName)}`;
}

/**
 * Convert missing required fields for display and display on console
 *
 * @param {Array<string>} missingOptions - missing option names
 * @returns {undefined} - none
 */
export function displayMissingOptionsMessage(missingOptions: string[]) {
  const fullMissingOptions = missingOptions.map(convertCamelOptionToLongOption);
  console.error(`Missing options: ${fullMissingOptions.join(', ')}`);
}
