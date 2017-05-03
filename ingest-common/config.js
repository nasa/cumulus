'use strict';

const yaml = require('js-yaml');

/**
 * Builds a YAML schema for resolving GitcResource directives
 * @param {function} resourceResolver - A function to use to resolve GitcResource directives
 * @return - The schema
 */
const buildSchema = (resourceResolver) => {
  const resourceType = new yaml.Type('!GitcResource', {
    kind: 'scalar',
    construct: resourceResolver
  });
  return yaml.Schema.create([resourceType]);
};

/**
 * Parses the given YAML collection string with the given resource resolver
 * @param {string} collectionsStr - The YAML string to parse
 * @param {function} resourceResolver - A function of string -> string used to resolve
 *                                      logical resources into stack-specific URI/ARNs
 * @return - The object created by parsing the yaml
 */
exports.parseConfig = (collectionsStr, resourceResolver) =>
  yaml.safeLoad(collectionsStr, { schema: buildSchema(resourceResolver) });
