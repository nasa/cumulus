const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const test = require('ava');
const { randomString } = require('@cumulus/common/test-utils');
const { readFileSync } = require('fs');

const { s3Mixin } = require('../s3');

class MyTest {
  constructor(event) {
    this.provider = event.config.provider;
    this.collection = event.config.collection;
  }
}

class MyS3Test extends s3Mixin(MyTest) {}

test('verify constructor sets sourceBucket', (t) => {
  const event = {
    config: {
      collection: {
        provider_path: 'my/provider/path'
      },
      provider: {
        host: 'myBucket'
      }
    }
  };

  const myS3Test = new MyS3Test(event);

  t.is(myS3Test.sourceBucket, 'myBucket');
});

test('verify constructor behavior with provider_path', (t) => {
  const event = {
    config: {
      collection: {
        provider_path: 'my/provider/path'
      },
      provider: {
        host: 'myBucket'
      }
    }
  };

  const myS3Test = new MyS3Test(event);

  t.is(myS3Test.path, 'my/provider/path');
  t.is(myS3Test.keyPrefix, 'my/provider/path');
});

test('verify constructor behavior without provider_path', (t) => {
  const event = {
    config: {
      collection: {},
      provider: {
        host: 'myBucket'
      }
    }
  };

  const myS3Test = new MyS3Test(event);

  t.is(myS3Test.path, null);
  t.is(myS3Test.keyPrefix, null);
});

test('verify download with null path', async (t) => {
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
    t.is(files[0].key, name);
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
    t.is(files[0].key, Key);
  }
  finally {
    await recursivelyDeleteS3Bucket(Bucket);
  }
});
