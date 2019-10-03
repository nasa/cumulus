'use strict';

const test = require('ava');
const { listEcsClusters } = require('../ecs');
const aws = require('../aws');

const { isNil } = require('../util');

test.serial('listEcsClusters() returns an empty array if no clusters exist', async (t) => {
  aws.ecs().listClusters = (params = {}) => ({
    promise: async () => {
      if (isNil(params.nextToken)) return { clusterArns: [] };

      t.fail(`Unexpected nextToken: ${params.nextToken}`);
      return null;
    }
  });

  t.deepEqual(
    await listEcsClusters(),
    []
  );
});

test.serial('listEcsClusters() returns the list of cluster ARNs if no `nextToken` is returned by the ECS API', async (t) => {
  const listClustersResponses = [
    { clusterArns: ['abc', 'def'] }
  ];

  aws.ecs().listClusters = () => ({
    promise: async () => listClustersResponses.shift()
  });

  t.deepEqual(
    (await listEcsClusters()).sort(),
    ['abc', 'def'].sort()
  );
});

test.serial('listEcsClusters() returns the list of cluster ARNs if `nextToken` is returned by the ECS API', async (t) => {
  aws.ecs().listClusters = (params = {}) => ({
    promise: async () => {
      if (isNil(params.nextToken)) {
        return { clusterArns: ['abc', 'def'], nextToken: 'zyx' };
      }
      if (params.nextToken === 'zyx') {
        return { clusterArns: ['ghi', 'jkl'] };
      }

      t.fail(`Unexpected nextToken: ${params.nextToken}`);
      return null;
    }
  });

  t.deepEqual(
    (await listEcsClusters()).sort(),
    ['abc', 'def', 'ghi', 'jkl'].sort()
  );
});
