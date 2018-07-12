'use strict';

const test = require('ava');
const { URL } = require('url');
const {
  testUtils: { randomString },
  FakeEarthdataLoginServer
} = require('@cumulus/common');
const distributionEndpoint = require('../../endpoints/distribution');

test.beforeEach((t) => {
  process.env.protected = randomString();

  t.context.fakeEarthdataLoginServer = new FakeEarthdataLoginServer();
});

test.afterEach.always((t) => {
  t.context.fakeEarthdataLoginServer.close();
});

test.serial.cb("The S3 redirect includes the user's Earthdata Login username", (t) => {
  // Start the EarthdataLogin server and run the test
  t.context.fakeEarthdataLoginServer.listen(() => {
    process.env.EARTHDATA_BASE_URL = t.context.fakeEarthdataLoginServer.endpoint;

    const myUsername = randomString();
    const code = t.context.fakeEarthdataLoginServer.createAuthorizationCodeForUser(myUsername);

    const event = {
      pathParameters: {
        granuleId: randomString()
      },
      queryStringParameters: {
        code,
        state: randomString()
      }
    };

    // Call the distribution endpoint handler
    distributionEndpoint.handler(event, {}, (err, handlerResponse) => {
      if (err) throw t.end(err);

      t.is(handlerResponse.statusCode, '302');

      const redirectLocation = new URL(handlerResponse.headers.Location);
      t.is(redirectLocation.searchParams.get('x-EarthdataLoginUsername'), myUsername);

      t.end();
    });
  });
});

test('bucket and key are extracted correctly', (t) => {
  const objectParams = distributionEndpoint.getBucketAndKeyFromPathParams(
    'bucket-name/folder/key.txt'
  );

  t.deepEqual(
    objectParams,
    { Bucket: 'bucket-name', Key: 'folder/key.txt' }
  );
});

test('parsed signed URL generates', (t) => {
  const tokenInfo = {
    endpoint: '/api/users/cumulus-user'
  };

  const signedUrl = distributionEndpoint.generateParsedSignedUrl(
    tokenInfo,
    'bucket-name/folder/key.txt',
    ''
  );

  t.regex(
    signedUrl.href,
    /http:\/\/.*\/bucket-name\/folder\/key\.txt\?AWSAccessKeyId=my-access-key-id&Expires=.*\&Signature=.*\&x-EarthdataLoginUsername=cumulus-user/
  );
});
