'use strict';

const test = require('ava');
const { URL } = require('url');
const { FakeEarthdataLoginServer, randomString } = require('@cumulus/common').testUtils;

const distributionEndpoint = require('../endpoints/distribution');

test.beforeEach((t) => {
  process.env.protected = 'protected-bucket';

  t.context.fakeEarthdataLoginServer = new FakeEarthdataLoginServer();
});

test.afterEach.always((t) => {
  t.context.fakeEarthdataLoginServer.close();
});

test.serial.cb("The S3 redirect includes the user's URS username", (t) => {
  // Start the EarthdataLogin server and run the test
  t.context.fakeEarthdataLoginServer.listen(() => {
    process.env.EARTHDATA_BASE_URL = t.context.fakeEarthdataLoginServer.endpoint;

    const myUsername = randomString();
    const code = t.context.fakeEarthdataLoginServer.createAuthorizationCodeForUser(myUsername);

    const event = {
      pathParameters: {
        granuleId: 'my-granule-id'
      },
      queryStringParameters: {
        code,
        state: 'granule-key'
      }
    };

    // Call the distribution endpoint handler
    distributionEndpoint(event, {}, (err, handlerResponse) => {
      if (err) throw t.end(err);

      t.is(handlerResponse.statusCode, '302');

      const redirectLocation = new URL(handlerResponse.headers.Location);
      t.is(redirectLocation.searchParams.get('earthdataLoginUsername'), myUsername);

      t.end();
    });
  });
});
