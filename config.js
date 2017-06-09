'use strict';

const yaml = require('js-yaml');
const log = require('./log');

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
 * Given a resource object as returned by CloudFormation::DescribeStackResources, returns
 * the resource's ARN. Often this is the PhysicalResourceId property, but for Lambdas,
 * need to glean information and attempt to construct an ARN.
 * @param {StackResource} resource - The resource as returned by cloudformation
 * @returns {string} The ARN of the resource
 */
const resourceToArn = (resource) => {
  const physicalId = resource.PhysicalResourceId;
  if (physicalId.indexOf('arn:') === 0) {
    return physicalId;
  }
  const typesToArnFns = {
    'AWS::Lambda::Function': (cfResource, region, account) =>
      `arn:aws:lambda:${region}:${account}:function:${cfResource.PhysicalResourceId}`,
    'AWS::DynamoDB::Table': (cfResource, region, account) =>
      `arn:aws:dynamodb:${region}:${account}:table/${cfResource.PhysicalResourceId}`
  };

  const arnFn = typesToArnFns[resource.ResourceType];
  if (!arnFn) throw new Error(`Could not resolve resource type to ARN: ${resource.ResourceType}`);

  const arnParts = resource.StackId.split(':');
  const region = arnParts[3];
  const account = arnParts[4];
  return arnFn(resource, region, account);
};

/**
 * Returns a function that takes a logical resource key and uses the passed lookup map
 * and prefix to resolve that logical resource id as an AWS resource.  Lookups support one
 * property, '.Arn', e.g. MyLambdaFunction.Arn. If specified, the resolver will attempt
 * to return the ARN of the specified resource, otherwise it will return the PhysicalResourceId
 * @param {object} cfResourcesById - A mapping of logical ids to CloudFormation resources as
 *                                   returned by CloudFormation::DescribeStackResources
 * @param {string} prefix - A prefix to prepend to the given name if no resource matches the name.
 *                 This is a hack to allow us to prefix state machines with the stack name for IAM
 * @returns {function} The resolver function described above
 */
exports.resolveResource = (cfResourcesById, prefix) =>
  (key) => {
    console.log(`Resolving ${key}`);
    const [name, fn] = key.split('.');
    const resource = cfResourcesById[name] || cfResourcesById[prefix + name];
    if (!resource) throw new Error(`Resource not found: ${key}`);
    if (fn && ['Arn'].indexOf(fn) === -1) throw new Error(`Function not supported: ${key}`);
    const result = fn === 'Arn' ? resourceToArn(resource) : resource.PhysicalResourceId;
    log.info(`Resolved Resource: ${key} -> ${result}`);
    return result;
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
