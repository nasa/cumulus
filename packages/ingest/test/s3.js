const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { readFileSync } = require('fs');

const { s3Mixin } = require('../s3');

class MyTest {
  constructor(event) {
    this.host = event.config.provider.host;
    this.collection = event.config.collection;
  }
}

class MyS3Test extends s3Mixin(MyTest) {}

test('verify download without a provider_path', async (t) => {
  const Bucket = randomString();
  const Key = randomString();
  const Body = randomString();

  const event = {
    config: {
      collection: {},
      provider: {
        host: Bucket
      }
    }
  };

  const myS3Test = new MyS3Test(event);

  await s3().createBucket({ Bucket }).promise();
  try {
    await s3().putObject({ Bucket, Key, Body }).promise();

    try {
      const outputFilename = await myS3Test.download(null, Key);
      const fileContents = readFileSync(outputFilename, 'utf8');

      t.is(fileContents, Body);
    }
    catch (error) {
      t.fail(error);
    }
  }
  finally {
    await recursivelyDeleteS3Bucket(Bucket);
  }
});

test('verify download with path set', async (t) => {
  const Bucket = randomString();
  const Body = randomString();
  const providerPath = randomString();
  const name = randomString();
  const Key = `${providerPath}/${name}`;

  const event = {
    config: {
      collection: {
        provider_path: providerPath
      },
      provider: {
        host: Bucket
      }
    }
  };

  const myS3Test = new MyS3Test(event);

  await s3().createBucket({ Bucket }).promise();
  try {
    await s3().putObject({ Bucket, Key, Body }).promise();

    try {
      const outputFilename = await myS3Test.download(providerPath, name);
      const fileContents = readFileSync(outputFilename, 'utf8');

      t.is(fileContents, Body);
    }
    catch (error) {
      t.fail(error);
    }
  }
  finally {
    await recursivelyDeleteS3Bucket(Bucket);
  }
});

test('verify list with no prefix', async (t) => {
  const Bucket = randomString();
  const name = randomString();

  const event = {
    config: {
      collection: {},
      provider: {
        host: Bucket
      }
    }
  };

  const myS3Test = new MyS3Test(event);

  await s3().createBucket({ Bucket }).promise();
  try {
    await s3().putObject({ Bucket, Key: name, Body: 'hello' }).promise();

    const files = await myS3Test.list();

    t.is(files.length, 1);
    t.is(files[0].name, name);
    t.is(files[0].path, null);
  }
  finally {
    await recursivelyDeleteS3Bucket(Bucket);
  }
});

test('verify list with a prefix', async (t) => {
  const Bucket = randomString();
  const name = randomString();
  const providerPath = randomString();
  const Key = `${providerPath}/${name}`;

  const event = {
    config: {
      collection: {
        provider_path: providerPath
      },
      provider: {
        host: Bucket
      }
    }
  };

  const myS3Test = new MyS3Test(event);

  await s3().createBucket({ Bucket }).promise();
  try {
    await s3().putObject({ Bucket, Key, Body: 'hello' }).promise();

    const files = await myS3Test.list();

    t.is(files.length, 1);
    t.is(files[0].name, name);
    t.is(files[0].path, providerPath);
  }
  finally {
    await recursivelyDeleteS3Bucket(Bucket);
  }
});
