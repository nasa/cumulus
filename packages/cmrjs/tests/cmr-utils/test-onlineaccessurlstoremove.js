const test = require('ava');
const rewire = require('rewire');

const { randomId } = require('@cumulus/common/test-utils');

const cmrUtils = rewire('../../cmr-utils');

const onlineAccessURLsToRemove = cmrUtils.__get__('onlineAccessURLsToRemove');

test.beforeEach((t) => {
  t.context.bucketConfig = {
    private: { name: randomId('private'), type: 'private' },
    protected: { name: randomId('protected'), type: 'protected' },
    public: { name: randomId('public'), type: 'public' },
  };
  t.context.bucketTypes = Object.values(t.context.bucketConfig)
    .reduce(
      (acc, { name, type }) => ({ ...acc, [name]: type }),
      {}
    );
});

test('returns an empty set if no private files', (t) => {
  const movedFiles = [
    {
      key: 'some/path/protected-file.hdf',
      bucket: t.context.bucketConfig.protected.name,
    },
  ];
  const actual = onlineAccessURLsToRemove(movedFiles, t.context.bucketTypes);

  t.deepEqual(actual, []);
});

test('returns a list of files to remove if there are private files', (t) => {
  const movedFiles = [
    {
      key: 'some/path/protected-file.hdf',
      bucket: t.context.bucketConfig.protected.name,
    },
    {
      key: 'some/path/private-file.hdf',
      bucket: t.context.bucketConfig.private.name,
    },

  ];
  const actual = onlineAccessURLsToRemove(movedFiles, t.context.bucketTypes);

  t.deepEqual(actual, [{ URL: 'some/path/private-file.hdf' }]);
});
