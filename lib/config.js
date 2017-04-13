'use strict';

const yaml = require('js-yaml');

const buildSchema = (resourceResolver) => {
  const resourceType = new yaml.Type('!GitcResource', {
    kind: 'scalar',
    construct: resourceResolver
  });
  return yaml.Schema.create([resourceType]);
};

// Parses collections.yml string
// Returns a list of collections in the YAML document
exports.parseConfig = (collectionsStr, resourceResolver) =>
  yaml.safeLoad(collectionsStr, { schema: buildSchema(resourceResolver) });
