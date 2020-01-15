'use strict';

const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');
const aws = require('@cumulus/aws-client/services');

const inventory = rewire('../src/inventory');
const mergeResourceLists = inventory.__get__('mergeResourceLists');
const resourceDiff = inventory.__get__('resourceDiff');
const listAwsResources = inventory.__get__('listAwsResources');

const stateFile = require('../src/stateFile');

let listResourcesForFileStub;
let listTfStateFilesStub;
let ecsStub;
let ec2Stub;

function resourcesForStateFile(sf) {
  if (sf === 'stateFile1') {
    return {
      ecsClusters: ['clusterArn1', 'clusterArn2'],
      ec2Instances: ['i-000']
    };
  }

  if (sf === 'stateFile2') {
    return {
      ecsClusters: ['clusterArn3'],
      ec2Instances: ['i-111', 'i-222']
    };
  }

  return {};
}

test.before(() => {
  listResourcesForFileStub = sinon
    .stub(stateFile, 'listResourcesForFile')
    .callsFake((sf) => resourcesForStateFile(sf));

  listTfStateFilesStub = sinon
    .stub(stateFile, 'listTfStateFiles')
    .returns(['stateFile1', 'stateFile2']);

  ecsStub = sinon.stub(aws, 'ecs')
    .returns({
      listClusters: () => ({
        promise: () =>
          Promise.resolve({
            clusterArns: ['clusterArn1', 'clusterArn2', 'clusterArn3', 'clusterArn4']
          })
      })
    });

  ec2Stub = sinon.stub(aws, 'ec2')
    .returns({
      describeInstances: () => ({
        promise: () =>
          Promise.resolve({
            Reservations: [
              {
                Instances: [
                  { InstanceId: 'i-000' },
                  { InstanceId: 'i-111' }
                ]
              },
              {
                Instances: [
                  { InstanceId: 'i-222' },
                  { InstanceId: 'i-333' }
                ]
              }
            ]
          })
      })
    });
});

test.after.always(() => {
  listResourcesForFileStub.restore();
  listTfStateFilesStub.restore();
  ecsStub.restore();
  ec2Stub.restore();
});

test('mergeResourceLists merges resource object by key', (t) => {
  const x = {
    ecsClusters: [
      {
        arn: 'clusterArn1',
        id: 'id1'
      },
      {
        arn: 'clusterArn2',
        id: 'id2'
      }
    ]
  };

  const y = {
    ecsClusters: [
      {
        arn: 'clusterArn3',
        id: 'id3'
      }
    ],
    ec2Instances: [
      'i-12345'
    ]
  };

  const merged = mergeResourceLists(x, y);

  t.deepEqual(merged, {
    ecsClusters: [
      {
        arn: 'clusterArn1',
        id: 'id1'
      },
      {
        arn: 'clusterArn2',
        id: 'id2'
      },
      {
        arn: 'clusterArn3',
        id: 'id3'
      }
    ],
    ec2Instances: [
      'i-12345'
    ]
  });
});

test('mergeResourceLists correctly merges null or empty entries', (t) => {
  const sampleResource = {
    ecsClusters: [
      {
        arn: 'clusterArn1',
        id: 'id1'
      },
      {
        arn: 'clusterArn2',
        id: 'id2'
      }
    ]
  };

  t.deepEqual(mergeResourceLists(null, sampleResource), sampleResource);

  t.deepEqual(mergeResourceLists(sampleResource, null), sampleResource);

  t.deepEqual(mergeResourceLists({}, sampleResource), sampleResource);
});

test('mergeResourceLists correctly merges different resources', (t) => {
  const ecs = {
    ecsClusters: [
      {
        arn: 'clusterArn1',
        id: 'id1'
      },
      {
        arn: 'clusterArn2',
        id: 'id2'
      }
    ]
  };

  const ec2 = {
    ec2Instances: [
      'i-12345'
    ]
  };

  t.deepEqual(mergeResourceLists(ecs, ec2), {
    ec2Instances: ec2.ec2Instances,
    ecsClusters: ecs.ecsClusters
  });
});

test('resourceDiff lists items that are only in the first object', (t) => {
  const x = {
    ecsClusters: [
      'clusterArn1',
      'clusterArn2'
    ],
    ec2Instances: [
      'i-12345'
    ]
  };

  const y = {
    ecsClusters: [
      'clusterArn1'
    ],
    test: [
      'test'
    ]
  };

  const diff = resourceDiff(x, y);

  t.deepEqual(diff, {
    ecsClusters: [
      'clusterArn2'
    ],
    ec2Instances: [
      'i-12345'
    ]
  });
});

test('listTfResources merges resources correctly', async (t) => {
  const tfResources = await inventory.listTfResources(['stateFile1', 'stateFile2']);

  t.deepEqual(tfResources, {
    ecsClusters: ['clusterArn1', 'clusterArn2', 'clusterArn3'],
    ec2Instances: ['i-000', 'i-111', 'i-222']
  });
});

test('listAwsResources properly combines ec2 intsances', async (t) => {
  const awsResources = await listAwsResources();

  t.deepEqual(awsResources,
    {
      ecsClusters: ['clusterArn1', 'clusterArn2', 'clusterArn3', 'clusterArn4'],
      ec2Instances: ['i-000', 'i-111', 'i-222', 'i-333']
    });
});

test('reconcileResources returns only resources not specified in TF files', async (t) => {
  const resources = await inventory.reconcileResources();

  t.deepEqual(resources,
    {
      ecsClusters: ['clusterArn4'],
      ec2Instances: ['i-333']
    });
});
