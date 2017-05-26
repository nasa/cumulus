'use strict';

const { s3 } = require('./aws');
const yaml = require('js-yaml');
const { BadRequestError } = require('./api-errors');
const { fromJS } = require('immutable');

const COLLECTIONS_YAML = 'ingest/collections.yml';

// Potential performation optimization: Cache collection config

/**
 * getCollectionsYaml - Fetches the collections yaml from S3.
 *
 * @param stackName Name of the step functions deployment stack.
 */
const getCollectionsYaml = async (stackName) => {
  try {
    const resp = await s3().getObject(
      { Bucket: `${stackName}-deploy`,
        Key: COLLECTIONS_YAML }).promise();
    return resp.Body.toString();
  }
  catch (error) {
    if (error.code === 'NoSuchBucket') {
      throw new BadRequestError(`Stack name [${stackName}] does not appear to exist`);
    }
    throw error;
  }
};

/**
 * Parses the collection yaml into a Immutable JS javascript object.
 */
const parseCollectionYaml = (collectionsYaml) => {
  const resourceType = new yaml.Type('!GitcResource', {
    kind: 'scalar'
  });
  const schema = yaml.Schema.create([resourceType]);
  return fromJS(yaml.safeLoad(collectionsYaml, { schema: schema }));
};

/**
 * Returns a parsed collection config
 */
const loadCollectionConfig = async stackName =>
  parseCollectionYaml(await getCollectionsYaml(stackName));

module.exports = {
  loadCollectionConfig,

  // For testing
  parseCollectionYaml
};
