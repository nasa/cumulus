'use strict';

const fs = require('fs');
const sinon = require('sinon');
const test = require('ava');
const aws = require('@cumulus/common/aws');
const { StepFunction } = require('@cumulus/ingest/aws');
const { CMR } = require('@cumulus/cmrjs');
const { DefaultProvider } = require('@cumulus/ingest/crypto');
const { randomString } = require('@cumulus/common/test-utils');
const xml2js = require('xml2js');
const { xmlParseOptions } = require('@cumulus/cmrjs/utils');

const assertions = require('../../lib/assertions');
const models = require('../../models');
const bootstrap = require('../../lambdas/bootstrap');
const handleRequest = require('../../endpoints/granules');
const indexer = require('../../es/indexer');
const {
  fakeGranuleFactoryV2,
  fakeUserFactory
} = require('../../lib/testUtils');
const { Search } = require('../../es/search');

const createBucket = (Bucket) => aws.s3().createBucket({ Bucket }).promise();

function createBuckets(buckets) {
  return Promise.all(buckets.map(createBucket));
}

function deleteBuckets(buckets) {
  return Promise.all(buckets.map(aws.recursivelyDeleteS3Bucket));
}

const putObject = (params) => aws.s3().putObject(params).promise();

async function runTestUsingBuckets(buckets, testFunction) {
  try {
    await createBuckets(buckets);
    await testFunction();
  }
  finally {
    await deleteBuckets(buckets);
  }
}

// create all the variables needed across this test
let esClient;
let esIndex;
let granuleModel;
let authToken;
let userModel;
test.before(async () => {
  esIndex = randomString();
  process.env.GranulesTable = randomString();
  process.env.UsersTable = randomString();
  process.env.stackName = randomString();
  process.env.internal = randomString();

  // create esClient
  esClient = await Search.es('fakehost');

  // add fake elasticsearch index
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex);

  // create a fake bucket
  await createBucket(process.env.internal);

  // create fake Granules table
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  // create fake Users table
  userModel = new models.User();
  await userModel.createTable();

  authToken = (await userModel.create(fakeUserFactory())).password;
});

test.beforeEach(async (t) => {
  t.context.authHeaders = {
    Authorization: `Bearer ${authToken}`
  };

  // create fake granule records
  t.context.fakeGranules = [
    fakeGranuleFactoryV2({ status: 'completed' }),
    fakeGranuleFactoryV2({ status: 'failed' })
  ];

  for (let i = 0; i < t.context.fakeGranules.length; i += 1) {
    const granule = t.context.fakeGranules[i];
    const record = await granuleModel.create(granule); // eslint-disable-line no-await-in-loop
    await indexer.indexGranule(esClient, record, esIndex); // eslint-disable-line no-await-in-loop
  }

  await Promise.all(t.context.fakeGranules.map((granule) =>
    granuleModel.create(granule)
      .then((record) => indexer.indexGranule(esClient, record, esIndex))));
});

test.after.always(async () => {
  await granuleModel.deleteTable();
  await userModel.deleteTable();
  await esClient.indices.delete({ index: esIndex });
  await aws.recursivelyDeleteS3Bucket(process.env.internal);
});


test.serial('default returns list of granules', async (t) => {
  const event = {
    httpMethod: 'GET',
    headers: t.context.authHeaders
  };

  const response = await handleRequest(event);

  const { meta, results } = JSON.parse(response.body);
  t.is(results.length, 2);
  t.is(meta.stack, process.env.stackName);
  t.is(meta.table, 'granule');
  t.is(meta.count, 2);
  const granuleIds = t.context.fakeGranules.map((i) => i.granuleId);
  results.forEach((r) => {
    t.true(granuleIds.includes(r.granuleId));
  });
});

test.serial('A GET request without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  const response = await handleRequest(request);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('A GET request with pathParameters.granuleName set and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {},
    pathParameters: {
      granuleName: 'asdf'
    }
  };

  const response = await handleRequest(request);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('A PUT request with pathParameters.granuleName set and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'PUT',
    headers: {},
    pathParameters: {
      granuleName: 'asdf'
    }
  };

  const response = await handleRequest(request);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('A DELETE request with pathParameters.granuleName set and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    headers: {},
    pathParameters: {
      granuleName: 'asdf'
    }
  };

  const response = await handleRequest(request);

  assertions.isAuthorizationMissingResponse(t, response);
});

test.serial('GET returns an existing granule', async (t) => {
  const event = {
    httpMethod: 'GET',
    pathParameters: {
      granuleName: t.context.fakeGranules[0].granuleId
    },
    headers: t.context.authHeaders
  };

  const response = await handleRequest(event);

  const { granuleId } = JSON.parse(response.body);
  t.is(granuleId, t.context.fakeGranules[0].granuleId);
});

test.serial('GET fails if granule is not found', async (t) => {
  const event = {
    httpMethod: 'GET',
    pathParameters: {
      granuleName: 'unknownGranule'
    },
    headers: t.context.authHeaders
  };

  const response = await handleRequest(event);

  t.is(response.statusCode, 404);
  const { message } = JSON.parse(response.body);
  t.is(message, 'Granule not found');
});

test.serial('PUT fails if action is not supported', async (t) => {
  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: t.context.fakeGranules[0].granuleId
    },
    headers: t.context.authHeaders,
    body: JSON.stringify({ action: 'reprocess' })
  };

  const response = await handleRequest(event);

  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.true(message.includes('Action is not supported'));
});

test.serial('PUT fails if action is not provided', async (t) => {
  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: t.context.fakeGranules[0].granuleId
    },
    headers: t.context.authHeaders
  };

  const response = await handleRequest(event);

  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.is(message, 'Action is missing');
});

test.serial('reingest a granule', async (t) => {
  const fakeSFResponse = {
    execution: {
      input: JSON.stringify({
        meta: {
          workflow_name: 'IngestGranule'
        },
        payload: {}
      })
    }
  };

  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: t.context.fakeGranules[0].granuleId
    },
    headers: t.context.authHeaders,
    body: JSON.stringify({ action: 'reingest' })
  };

  // fake workflow
  process.env.bucket = process.env.internal;
  const message = JSON.parse(fakeSFResponse.execution.input);
  const key = `${process.env.stackName}/workflows/${message.meta.workflow_name}.json`;
  await putObject({ Bucket: process.env.bucket, Key: key, Body: 'test data' });

  sinon.stub(
    StepFunction,
    'getExecutionStatus'
  ).callsFake(() => Promise.resolve(fakeSFResponse));

  const response = await handleRequest(event);

  const body = JSON.parse(response.body);
  t.is(body.status, 'SUCCESS');
  t.is(body.action, 'reingest');

  const updatedGranule = await granuleModel.get({ granuleId: t.context.fakeGranules[0].granuleId });
  t.is(updatedGranule.status, 'running');

  StepFunction.getExecutionStatus.restore();
});

test.serial('apply an in-place workflow to an existing granule', async (t) => {
  const fakeSFResponse = {
    execution: {
      input: JSON.stringify({
        meta: {
          workflow_name: 'inPlaceWorkflow'
        },
        payload: {}
      })
    }
  };

  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: t.context.fakeGranules[0].granuleId
    },
    headers: t.context.authHeaders,
    body: JSON.stringify({
      action: 'applyWorkflow',
      workflow: 'inPlaceWorkflow',
      messageSource: 'output'
    })
  };

  //fake in-place workflow
  process.env.bucket = process.env.internal;
  const message = JSON.parse(fakeSFResponse.execution.input);
  const key = `${process.env.stackName}/workflows/${message.meta.workflow_name}.json`;
  await putObject({ Bucket: process.env.bucket, Key: key, Body: 'fake in-place workflow' });

  // return fake previous execution
  sinon.stub(
    StepFunction,
    'getExecutionStatus'
  ).callsFake(() => Promise.resolve({
    execution: {
      output: JSON.stringify({
        meta: {
          workflow_name: 'IngestGranule'
        },
        payload: {}
      })
    }
  }));

  const response = await handleRequest(event);
  const body = JSON.parse(response.body);
  t.is(body.status, 'SUCCESS');
  t.is(body.action, 'applyWorkflow inPlaceWorkflow');

  const updatedGranule = await granuleModel.get({ granuleId: t.context.fakeGranules[0].granuleId });
  t.is(updatedGranule.status, 'running');

  StepFunction.getExecutionStatus.restore();
});

test.serial('remove a granule from CMR', async (t) => {
  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: t.context.fakeGranules[0].granuleId
    },
    headers: t.context.authHeaders,
    body: JSON.stringify({ action: 'removeFromCmr' })
  };

  sinon.stub(
    DefaultProvider,
    'decrypt'
  ).callsFake(() => Promise.resolve('fakePassword'));

  sinon.stub(
    CMR.prototype,
    'deleteGranule'
  ).callsFake(() => Promise.resolve());

  const response = await handleRequest(event);

  const body = JSON.parse(response.body);
  t.is(body.status, 'SUCCESS');
  t.is(body.action, 'removeFromCmr');

  const updatedGranule = await granuleModel.get({ granuleId: t.context.fakeGranules[0].granuleId });
  t.is(updatedGranule.published, false);
  t.is(updatedGranule.cmrLink, null);

  CMR.prototype.deleteGranule.restore();
  DefaultProvider.decrypt.restore();
});

test.serial('DELETE deleting an existing granule that is published will fail', async (t) => {
  const event = {
    httpMethod: 'DELETE',
    pathParameters: {
      granuleName: t.context.fakeGranules[0].granuleId
    },
    headers: t.context.authHeaders
  };

  const response = await handleRequest(event);

  t.is(response.statusCode, 400);
  const { message } = JSON.parse(response.body);
  t.is(
    message,
    'You cannot delete a granule that is published to CMR. Remove it from CMR first'
  );
});

test.serial('DELETE deleting an existing unpublished granule', async (t) => {
  const buckets = {
    protected: {
      name: randomString(),
      type: 'protected'
    },
    public: {
      name: randomString(),
      type: 'public'
    }
  };
  const newGranule = fakeGranuleFactoryV2({ status: 'failed' });
  newGranule.published = false;
  newGranule.files = [
    {
      bucket: buckets.protected.name,
      name: `${newGranule.granuleId}.hdf`,
      filename: `s3://${buckets.protected.name}/${randomString()}/${newGranule.granuleId}.hdf`
    },
    {
      bucket: buckets.protected.name,
      name: `${newGranule.granuleId}.cmr.xml`,
      filename: `s3://${buckets.protected.name}/${randomString()}/${newGranule.granuleId}.cmr.xml`
    },
    {
      bucket: buckets.public.name,
      name: `${newGranule.granuleId}.jpg`,
      filename: `s3://${buckets.public.name}/${randomString()}/${newGranule.granuleId}.jpg`
    }
  ];

  await createBuckets([
    buckets.protected.name,
    buckets.public.name
  ]);

  for (let i = 0; i < newGranule.files.length; i += 1) {
    const file = newGranule.files[i];
    const parsed = aws.parseS3Uri(file.filename);
    await putObject({ // eslint-disable-line no-await-in-loop
      Bucket: parsed.Bucket,
      Key: parsed.Key,
      Body: `test data ${randomString()}`
    });
  }

  // create a new unpublished granule
  await granuleModel.create(newGranule);

  const event = {
    httpMethod: 'DELETE',
    pathParameters: {
      granuleName: newGranule.granuleId
    },
    headers: t.context.authHeaders
  };

  const response = await handleRequest(event);

  t.is(response.statusCode, 200);
  const { detail } = JSON.parse(response.body);
  t.is(detail, 'Record deleted');

  // verify the files are deleted
  for (let i = 0; i < newGranule.files.length; i += 1) {
    const file = newGranule.files[i];
    const parsed = aws.parseS3Uri(file.filename);
    t.false(await aws.fileExists(parsed.Bucket, parsed.Key)); // eslint-disable-line no-await-in-loop
  }

  await deleteBuckets([
    buckets.protected.name,
    buckets.public.name
  ]);
});

test.serial('move a granule with no .cmr.xml file', async (t) => {
  const bucket = process.env.internal;
  const secondBucket = randomString();
  const thirdBucket = randomString();

  await runTestUsingBuckets(
    [secondBucket, thirdBucket],
    async () => {
      const newGranule = fakeGranuleFactoryV2();

      newGranule.files = [
        {
          bucket,
          name: `${newGranule.granuleId}.txt`,
          filepath: `${process.env.stackName}/original_filepath/${newGranule.granuleId}.txt`,
          filename: `s3://${bucket}/${process.env.stackName}/original_filepath/${newGranule.granuleId}.txt`
        },
        {
          bucket,
          name: `${newGranule.granuleId}.md`,
          filename: `s3://${bucket}/${process.env.stackName}/original_filepath/${newGranule.granuleId}.md`
        },
        {
          bucket: secondBucket,
          name: `${newGranule.granuleId}.jpg`,
          filepath: `${process.env.stackName}/original_filepath/${newGranule.granuleId}.jpg`,
          filename: `s3://${secondBucket}/${process.env.stackName}/original_filepath/${newGranule.granuleId}.jpg`
        }
      ];

      await granuleModel.create(newGranule);

      await Promise.all(newGranule.files.map((file) => {
        const filepath = file.filepath || aws.parseS3Uri(file.filename).Key;
        putObject({ Bucket: file.bucket, Key: filepath, Body: 'test data' });
      }));

      const destinationFilepath = `${process.env.stackName}/granules_moved`;
      const destinations = [
        {
          regex: '.*.txt$',
          bucket,
          filepath: destinationFilepath
        },
        {
          regex: '.*.md$',
          bucket: thirdBucket,
          filepath: destinationFilepath
        },
        {
          regex: '.*.jpg$',
          bucket,
          filepath: destinationFilepath
        }
      ];

      const event = {
        httpMethod: 'PUT',
        pathParameters: {
          granuleName: newGranule.granuleId
        },
        headers: t.context.authHeaders,
        body: JSON.stringify({
          action: 'move',
          destinations
        })
      };

      const response = await handleRequest(event);

      const body = JSON.parse(response.body);
      t.is(body.status, 'SUCCESS');
      t.is(body.action, 'move');

      await aws.s3().listObjects({ Bucket: bucket, Prefix: destinationFilepath }).promise().then((list) => {
        t.is(list.Contents.length, 2);
        list.Contents.forEach((item) => {
          t.is(item.Key.indexOf(destinationFilepath), 0);
        });
      });

      await aws.s3().listObjects({ Bucket: thirdBucket, Prefix: destinationFilepath }).promise().then((list) => {
        t.is(list.Contents.length, 1);
        list.Contents.forEach((item) => {
          t.is(item.Key.indexOf(destinationFilepath), 0);
        });
      });

      // check the granule in table is updated
      const updatedGranule = await granuleModel.get({ granuleId: newGranule.granuleId });
      updatedGranule.files.forEach((file) => {
        t.true(file.filepath.startsWith(destinationFilepath));
        const destination = destinations.find((dest) => file.name.match(dest.regex));
        t.is(destination.bucket, file.bucket);
        t.true(file.filename.startsWith(aws.buildS3Uri(destination.bucket, destinationFilepath)));
      });
    }
  );
});

test.serial('move a file and update metadata', async (t) => {
  const bucket = process.env.internal;
  process.env.bucket = bucket;
  const buckets = {
    protected: {
      name: process.env.internal,
      type: 'protected'
    },
    public: {
      name: randomString(),
      type: 'public'
    }
  };

  process.env.DISTRIBUTION_ENDPOINT = 'http://example.com/';
  await putObject({
    Bucket: bucket,
    Key: `${process.env.stackName}/workflows/buckets.json`,
    Body: JSON.stringify(buckets)
  });

  await createBucket(buckets.public.name);
  const newGranule = fakeGranuleFactoryV2();
  const metadata = fs.createReadStream('tests/data/meta.xml');

  newGranule.files = [
    {
      bucket,
      name: `${newGranule.granuleId}.txt`,
      filepath: `${process.env.stackName}/original_filepath/${newGranule.granuleId}.txt`,
      filename: `s3://${bucket}/${process.env.stackName}/original_filepath/${newGranule.granuleId}.txt`
    },
    {
      bucket: buckets.public.name,
      name: `${newGranule.granuleId}.cmr.xml`,
      filepath: `${process.env.stackName}/original_filepath/${newGranule.granuleId}.cmr.xml`,
      filename: `s3://${buckets.public.name}/${process.env.stackName}/original_filepath/${newGranule.granuleId}.cmr.xml`
    }
  ];

  await granuleModel.create(newGranule);

  await Promise.all(newGranule.files.map((file) => {
    if (file.name === `${newGranule.granuleId}.txt`) {
      return putObject({ Bucket: file.bucket, Key: file.filepath, Body: 'test data' });
    }
    return putObject({ Bucket: file.bucket, Key: file.filepath, Body: metadata });
  }));

  const destinationFilepath = `${process.env.stackName}/moved_granules`;
  const destinations = [
    {
      regex: '.*.txt$',
      bucket,
      filepath: destinationFilepath
    }
  ];

  const event = {
    httpMethod: 'PUT',
    pathParameters: {
      granuleName: newGranule.granuleId
    },
    headers: t.context.authHeaders,
    body: JSON.stringify({
      action: 'move',
      destinations
    })
  };

  sinon.stub(
    CMR.prototype,
    'ingestGranule'
  ).returns({ result: { 'concept-id': 'id204842' } });

  const response = await handleRequest(event);

  const body = JSON.parse(response.body);
  t.is(body.status, 'SUCCESS');
  t.is(body.action, 'move');

  const list = await aws.s3().listObjects({ Bucket: bucket, Prefix: destinationFilepath }).promise();
  t.is(list.Contents.length, 1);
  list.Contents.forEach((item) => {
    t.is(item.Key.indexOf(destinationFilepath), 0);
  });

  const list2 = await aws.s3().listObjects({ Bucket: buckets.public.name, Prefix: `${process.env.stackName}/original_filepath` }).promise();
  t.is(list2.Contents.length, 1);
  t.is(newGranule.files[1].filepath, list2.Contents[0].Key);

  const file = await aws.s3().getObject({ Bucket: buckets.public.name, Key: newGranule.files[1].filepath }).promise();
  await aws.recursivelyDeleteS3Bucket(buckets.public.name);
  return new Promise((resolve, reject) => {
    xml2js.parseString(file.Body, xmlParseOptions, (err, data) => {
      if (err) return reject(err);
      return resolve(data);
    });
  }).then((xml) => {
    const newUrl = xml.Granule.OnlineAccessURLs.OnlineAccessURL[0].URL;
    const newDestination = `${process.env.DISTRIBUTION_ENDPOINT}${destinations[0].bucket}/${destinations[0].filepath}/${newGranule.files[0].name}`;
    t.is(newUrl, newDestination);
  });
});
