const test = require('ava');
const rewire = require('rewire');

const { BucketsConfig } = require('@cumulus/common');
const { randomId } = require('@cumulus/common/test-utils');

const cmrUtils = rewire('../../cmr-utils');

const onlineAccessURLsToRemove = cmrUtils.__get__('onlineAccessURLsToRemove');

test.beforeEach((t) => {
  t.context.bucketConfig = {
    private: { name: randomId('private'), type: 'private' },
    protected: { name: randomId('protected'), type: 'protected' },
    public: { name: randomId('public'), type: 'public' }
  };
  t.context.buckets = new BucketsConfig(t.context.bucketConfig);
});


test('returns an empty set if no private files', (t) => {
  const movedFiles = [
    {
      filepath: 'some/path/protected-file.hdf',
      bucket: t.context.bucketConfig.protected.name
    }
  ];
  const actual = onlineAccessURLsToRemove(movedFiles, t.context.buckets);

  t.deepEqual(actual, []);
});

test('returns a list of files to remove if there are private files', (t) => {
  const movedFiles = [
    {
      filepath: 'some/path/protected-file.hdf',
      bucket: t.context.bucketConfig.protected.name
    },
    {
      filepath: 'some/path/private-file.hdf',
      bucket: t.context.bucketConfig.private.name
    }

  ];
  const actual = onlineAccessURLsToRemove(movedFiles, t.context.buckets);

  t.deepEqual(actual, [{ URL: 'some/path/private-file.hdf' }]);
});
