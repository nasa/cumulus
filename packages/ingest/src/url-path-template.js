const get = require('lodash/get');
const moment = require('moment');
const path = require('path');

/**
 * evaluate the operation specified in template
 *
 * @param {string} name - the name of the operation
 * @param {object} args - the args (in array) of the operation
 * @param {object} context - the metadata used in the template
 * @returns {string} - the return value of the operation
 */
function evaluateOperation(name, args, context) {
  // args[0] is either an object path or a constant
  //   e.g. extractPath(file.path) or extractPath('/a/b/c')
  // assume args[0] is an object path if it starts with a key of context
  const isObjectPath = Object.keys(context).includes(args[0].split('.')[0]);
  const jsonPathValue = get(context, args[0], isObjectPath ? undefined : args[0]);

  if (name !== 'defaultTo' && !jsonPathValue) throw new Error(`Could not resolve path ${args[0]}`);

  const valueStr = jsonPathValue;

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
  case 'dateFormat': {
    return moment.utc(valueStr).format(args[1]);
  }
  case 'substring': {
    return String.prototype.substring.apply(String(valueStr), args.slice(1));
  }
  case 'extractPath': {
    return path.dirname(valueStr);
  }
  case 'defaultTo': {
    const isObjectPathSecondArg = Object.keys(context).includes(args[1].split('.')[0]);
    const jsonPathValueSecondArg = get(
      context, args[1],
      isObjectPathSecondArg ? undefined : args[1]
    );
    return jsonPathValue || jsonPathValueSecondArg;
  }
  default:
    throw new Error(`Could not support operation ${name}`);
  }
}

/**
 * retrieve the actual value of the matched string and return it
 *
 * @param {object} context - the metadata used in the template
 * @param {string} submatch - the parenthesized submatch string
 * @returns {string} - the value of the matched string
 */
function templateReplacer(context, submatch) {
  // parse the string to get the operation and arguments
  const expressionRegex = /([^(]+)\(([^)]+)\)/;
  const matches = submatch.match(expressionRegex);

  // submatch contains operation and args
  if (submatch.match(expressionRegex)) {
    const name = matches[1];
    const args = matches[2].split(/\s*,\s*/);

    return evaluateOperation(name, args, context);
  }

  const jsonPathValue = get(context, submatch);
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
  const templateRegex = /{([^{}]+)}/g;
  try {
    // match: The matched substring, submatch: The parenthesized submatch string
    const replacedPath = pathTemplate.replace(templateRegex, (match, submatch) =>
      templateReplacer(context, submatch));
    if (replacedPath.match(templateRegex)) {
      return urlPathTemplate(replacedPath, context);
    }
    return replacedPath;
  } catch (error) {
    throw new Error(
      `Could not resolve path template "${pathTemplate}" with error "${error.toString()}"`
    );
  }
}

module.exports.urlPathTemplate = urlPathTemplate;
