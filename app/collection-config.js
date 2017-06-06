'use strict';

const { s3 } = require('./aws');
const { BadRequestError } = require('./api-errors');
const { fromJS } = require('immutable');
const commonConfig = require('ingest-common/config');

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
 * TODO
 */
const ingestStackResourceResolver = (ingestStackResources, prefix) =>
  commonConfig.resolveResource(ingestStackResources.toJS(), prefix);

/**
 * Parses the collection yaml into a Immutable JS javascript object.
 */
const parseCollectionYaml = (collectionsYaml, resourceResolver) => {
  const result = fromJS(commonConfig.parseConfig(collectionsYaml, resourceResolver));

  if (resourceResolver) {
    // Update the keys in workflows to be the resolved names
    return result.updateIn(['workflows'], workflows => workflows.mapKeys(resourceResolver));
  }

  return result;
};

// TODO add a test of parsing the collection yaml with a resolver. Use a fake set of ingest stack
// resources

/**
 * Returns a parsed collection config
 */
const loadCollectionConfig = async (stackName, resourceResolver) =>
  parseCollectionYaml(await getCollectionsYaml(stackName), resourceResolver);

module.exports = {
  loadCollectionConfig,
  ingestStackResourceResolver,

  // For testing
  parseCollectionYaml
};
