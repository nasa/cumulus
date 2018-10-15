'use strict';

const test = require('ava');
const aws = require('@cumulus/common/aws');
const { randomString } = require('@cumulus/common/test-utils');
const reconciliationReportEndpoint = require('../../endpoints/reconciliation-reports');
const {
  fakeUserFactory,
  testEndpoint
} = require('../../lib/testUtils');
const assertions = require('../../lib/assertions');
const models = require('../../models');

process.env.invoke = 'granule-reconciliation-reports';
process.env.stackName = 'test-stack';
process.env.system_bucket = 'test_system_bucket';
process.env.UsersTable = randomString();

const reportNames = [randomString(), randomString()];
const reportDirectory = `${process.env.stackName}/reconciliation-reports`;

let authHeaders;
let userModel;
test.before(async () => {
  userModel = new models.User();
  await userModel.createTable();

  const authToken = (await userModel.create(fakeUserFactory())).password;
  authHeaders = {
    Authorization: `Bearer ${authToken}`
  };
});

test.beforeEach(async () => {
  await aws.s3().createBucket({ Bucket: process.env.system_bucket }).promise();
  await Promise.all(reportNames.map((reportName) =>
    aws.s3().putObject({
      Bucket: process.env.system_bucket,
      Key: `${reportDirectory}/${reportName}`,
      Body: JSON.stringify({ test_key: `${reportName} test data` })
    }).promise()));
});

test.afterEach.always(async () => {
  await aws.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.after.always(async () => {
  await userModel.deleteTable();
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {}
  };

  return testEndpoint(reconciliationReportEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(reconciliationReportEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 POST without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'POST',
    headers: {}
  };

  return testEndpoint(reconciliationReportEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 DELETE with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      name: 'asdf'
    },
    headers: {}
  };

  return testEndpoint(reconciliationReportEndpoint, request, (response) => {
    assertions.isAuthorizationMissingResponse(t, response);
  });
});

test('CUMULUS-911 GET without pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(reconciliationReportEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-911 GET with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'GET',
    pathParameters: {
      name: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(reconciliationReportEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-911 POST with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'POST',
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(reconciliationReportEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test('CUMULUS-911 DELETE with pathParameters and with an unauthorized user returns an unauthorized response', async (t) => {
  const request = {
    httpMethod: 'DELETE',
    pathParameters: {
      name: 'asdf'
    },
    headers: {
      Authorization: 'Bearer ThisIsAnInvalidAuthorizationToken'
    }
  };

  return testEndpoint(reconciliationReportEndpoint, request, (response) => {
    assertions.isUnauthorizedUserResponse(t, response);
  });
});

test.serial('default returns list of reports', (t) => {
  const event = {
    httpMethod: 'GET',
    headers: authHeaders
  };

  return testEndpoint(reconciliationReportEndpoint, event, (response) => {
    const results = JSON.parse(response.body);
    t.is(results.results.length, 2);
    results.results.forEach((reportName) => t.true(reportNames.includes(reportName)));
  });
});

test.serial('get a report', async (t) => {
  await Promise.all(reportNames.map((reportName) => {
    const event = {
      pathParameters: {
        name: reportName
      },
      httpMethod: 'GET',
      headers: authHeaders
    };

    return testEndpoint(reconciliationReportEndpoint, event, (response) => {
      t.deepEqual(JSON.parse(response.body), { test_key: `${reportName} test data` });
    });
  }));
});

test.serial('delete a report', async (t) => {
  await Promise.all(reportNames.map((reportName) => {
    const event = {
      pathParameters: {
        name: reportName
      },
      httpMethod: 'DELETE',
      headers: authHeaders
    };

    return testEndpoint(reconciliationReportEndpoint, event, (response) => {
      t.deepEqual(JSON.parse(response.body), { message: 'Report deleted' });
    });
  }));
});

test.serial('create a report', (t) => {
  const event = {
    httpMethod: 'POST',
    headers: authHeaders
  };

  return testEndpoint(reconciliationReportEndpoint, event, (response) => {
    const content = JSON.parse(response.body);
    t.is(content.message, 'Report is being generated');
  });
});
