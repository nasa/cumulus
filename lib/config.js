'use strict';

const yaml = require('js-yaml');

const buildSchema = (resourceResolver) => {
  const resourceType = new yaml.Type('!GitcResource', {
    kind: 'scalar',
    construct: resourceResolver
  });
  return yaml.Schema.create([resourceType]);
};

/**
 * TODO Add docs
 */
exports.parseConfig = (collectionsStr, resourceResolver) =>
  yaml.safeLoad(collectionsStr, { schema: buildSchema(resourceResolver) });
