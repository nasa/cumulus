const test = require('ava');

const { S3 } = require('@aws-sdk/client-s3');
const client = require('../client');

test.beforeEach(() => {
  // Have to delete this env var to bypass "test mode" logic which will
  // always use us-east-1 as the region
  delete process.env.NODE_ENV;
});

test.afterEach.always(() => {
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
  process.env.NODE_ENV = 'test';
});

test.serial('client respects AWS_DEFAULT_REGION when creating service clients', async (t) => {
  process.env.AWS_DEFAULT_REGION = 'us-west-2';

  const s3client = client(S3)();
  t.is(await s3client.config.region(), 'us-west-2');
});

test.serial('client defaults region to us-east-1 if AWS_DEFAULT_REGION env var is an empty string', async (t) => {
  process.env.AWS_DEFAULT_REGION = '';

  const s3client = client(S3)();
  t.is(await s3client.config.region(), 'us-east-1');
});

test.serial('client respects AWS_REGION when creating service clients', async (t) => {
  process.env.AWS_REGION = 'us-west-2';

  const s3client = client(S3)();
  t.is(await s3client.config.region(), 'us-west-2');
});

test.serial('client defaults region to us-east-1 if no env var is not set', async (t) => {
  const s3client = client(S3)();
  t.is(await s3client.config.region(), 'us-east-1');
});

test.serial('client defaults region to us-east-1 if AWS_REGION env var is an empty string', async (t) => {
  process.env.AWS_REGION = '';

  const s3client = client(S3)();
  t.is(await s3client.config.region(), 'us-east-1');
});

test.serial('client memoizes same service with no arguments correctly', (t) => {
  let count = 0;
  class FakeService {
    constructor() {
      this.serviceIdentifier = this.name;
      count += 1;
    }
  }

  client(FakeService)();
  client(FakeService)();
  t.is(count, 1);
});

test.serial('client memoizes same service with same arguments correctly', (t) => {
  let count = 0;
  // Use a different fake service name to avoid test interference
  class FakeService1 {
    constructor() {
      this.serviceIdentifier = this.name;
      count += 1;
    }
  }

  client(FakeService1)({ foo: 'bar' });
  client(FakeService1)({ foo: 'bar' });
  t.is(count, 1);
});

test.serial('client does not memoize same service with different versions', (t) => {
  let count = 0;
  // Use a different fake service name to avoid test interference
  class FakeService2 {
    constructor() {
      this.serviceIdentifier = this.name;
      count += 1;
    }
  }

  client(FakeService2, 'v1')();
  client(FakeService2, 'v2')();
  t.is(count, 2);
});

test.serial('client does not memoize service with different arguments', (t) => {
  let count = 0;
  // Use a different fake service name to avoid test interference
  class FakeService3 {
    constructor() {
      this.serviceIdentifier = this.name;
      count += 1;
    }
  }

  client(FakeService3, { foo: 'bar' })();
  client(FakeService3, { foo: 'baz' })();
  t.is(count, 2);
});

test.serial('client does not memoize different services with same arguments', (t) => {
  let count = 0;
  // Use a different fake service name to avoid test interference
  class FooService {
    constructor() {
      this.serviceIdentifier = this.name;
      count += 1;
    }
  }
  class BarService {
    constructor() {
      this.serviceIdentifier = this.name;
      count += 1;
    }
  }

  client(FooService)({ foo: 'bar' });
  client(BarService)({ foo: 'bar' });
  t.is(count, 2);
});

test.serial('awsClient() respects configuration', (t) => {
  class TestService {
    constructor(options) {
      this.serviceIdentifier = this.name;
      this.region = options.region;
      this.apiVersion = options.apiVersion;
    }
  }

  const serviceClient = client(TestService, 'v1', { region: 'us-east-1' })();
  t.is(serviceClient.region, 'us-east-1');
  t.is(serviceClient.apiVersion, 'v1');
});

test.serial('awsClient() respects override configuration', (t) => {
  class TestService {
    constructor(options) {
      this.serviceIdentifier = this.name;
      this.region = options.region;
      this.apiVersion = options.apiVersion;
    }
  }

  const serviceClient = client(TestService, 'v1', { region: 'us-east-1' })({
    region: 'us-west-2',
  });
  t.is(serviceClient.region, 'us-west-2');
  t.is(serviceClient.apiVersion, 'v1');
});
