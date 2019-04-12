const get = require('lodash.get');

/**
* evaluate the operation specified in template
*
* @param {string} name - the name of the operation
* @param {Object} args - the args (in array) of the operation
* @returns {string} - the return value of the operation
**/
function evaluateOperation(name, args) {
  const valueStr = args[0];
  switch (name) {
  case 'extractYear': {
    return new Date(valueStr).getUTCFullYear();
  }
  case 'extractMonth': {
    return (new Date(valueStr).getUTCMonth() + 1).toString();
  }
  case 'extractDate': {
    return new Date(valueStr).getUTCDate().toString();
  }
  case 'extractHour': {
    return new Date(valueStr).getUTCHours().toString();
  }
  case 'substring': {
    return String.prototype.substring.apply(String(valueStr), args.slice(1));
  }
  default:
    throw new Error(`Could not support operation ${name}`);
  }
}

/**
 * retrieve the actual value of the matched string and return it
 *
 * @param {Object} context - the metadata used in the template
 * @param {string} submatch - the parenthesized submatch string
 * @returns {string} - the value of the matched string
 */
function templateReplacer(context, submatch) {
  // parse the string to get the operation and arguments
  const expressionRegex = /([^\(]+)\(([^\)]+)\)/;
  const matches = submatch.match(expressionRegex);

  // submatch contains operation
  if (submatch.match(expressionRegex)) {
    const name = matches[1];
    const args = matches[2].split(',');
    const jsonPathValue = get(context, args[0], null);
    if (!jsonPathValue) throw new Error(`Could not resolve path ${args[0]}`);
    args[0] = jsonPathValue;
    return evaluateOperation(name, args);
  }

  const jsonPathValue = get(context, submatch, null);
  if (!jsonPathValue) throw new Error(`Could not resolve path ${submatch}`);
  return jsonPathValue;
}

/**
* define the path of a file based on the metadata of a granule
*
* @param {string} pathTemplate - the template that defines the path,
* using `{}` for string interpolation
* @param {Object} context - the metadata used in the template
* @returns {string} - the url path for the file
**/
function urlPathTemplate(pathTemplate, context) {
  const templateRegex = /{([^}]+)}/g;
  try {
    // match: The matched substring, submatch: The parenthesized submatch string
    return pathTemplate.replace(templateRegex, (match, submatch) =>
      templateReplacer(context, submatch));
  } catch (e) {
    throw new Error(
      `Could not resolve path template "${pathTemplate}" with error "${e.toString()}"`
    );
  }
}

module.exports.urlPathTemplate = urlPathTemplate;
