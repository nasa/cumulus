'use strict';

const { s3 } = require('./aws');
const { BadRequestError } = require('./api-errors');
const { fromJS } = require('immutable');
const commonConfig = require('cumulus-common/config');
const { memoize } = require('./cache');
const sr = require('./stack-resources');

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
 * Returns a resolver function to use when parsing the yaml that will find an resolve items in
 * the stack resources from GIBS ingest.
 * * ingestStackResources - an immutable map of resource logical ids to details returned from
 * cloud formation of ingest resources.
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

/**
 * Converts a stack name like gitc-test to the prefix used for naming certain resources like
 * gitcxtestxx.
 */
const stackNameToAlphanumPrefix = stackName => stackName.split('-').map(
  (s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');

/**
 * Returns a parsed collection config
 */
const loadCollectionConfig = memoize(async (stackName) => {
  const ingestStackResources = await sr.getIngestStackResources(stackName);
  const prefix = stackNameToAlphanumPrefix(stackName);
  const resourceResolver = ingestStackResourceResolver(ingestStackResources, prefix);
  return parseCollectionYaml(await getCollectionsYaml(stackName), resourceResolver);
});

module.exports = {
  loadCollectionConfig,
  // For testing
  ingestStackResourceResolver,
  parseCollectionYaml
};
