const test = require('ava');
const rewire = require('rewire');

const cmrUtil = rewire('../../cmr-utils');
const mergeURLs = cmrUtil.__get__('mergeURLs');

const sortByURL = (a, b) => a.URL < b.URL;


test('Merges two sets of URLs.', (t) => {
  const originalURLs = [
    {
      URL: 'https://path/to/metadata.cmr.xml',
      URLDescription: 'File to download'
    }
  ];
  const newURLs = [
    {
      URL: 's3://path/to/different-file.hdf',
      URLDescription: 'File to download'
    }
  ];
  const expected = [...originalURLs, ...newURLs];

  const actual = mergeURLs(originalURLs, newURLs);

  t.deepEqual(expected.sort(sortByURL), actual.sort(sortByURL));
});

test('Replaces an updated URL.', (t) => {
  const originalURLs = [
    {
      URL: 'https://path/to/metadata.cmr.xml',
      URLDescription: 'File to download'
    }
  ];
  const newURLs = [
    {
      URL: 's3://path/to/metadata.cmr.xml',
      URLDescription: 'File to download'
    }
  ];
  const expected = [...newURLs];

  const actual = mergeURLs(originalURLs, newURLs);

  t.deepEqual(expected.sort(sortByURL), actual.sort(sortByURL));
});

test('Removes a file made private.', (t) => {
  const originalURLs = [
    {
      URL: 'https://path/to/metadata.cmr.xml',
      URLDescription: 'File to download'
    }
  ];
  const newURLs = [];
  const deletedUrls = [
    { URL: 'https://now/private/metadata.cmr.xml' }
  ];

  const expected = [];

  const actual = mergeURLs(originalURLs, newURLs, deletedUrls);

  t.deepEqual(expected.sort(sortByURL), actual.sort(sortByURL));
});

test('Replaces an updated URL, but keeps any additional metadata from the original urlObject.', (t) => {
  const originalURLs = [
    {
      URL: 'https://path/to/metadata.cmr.xml',
      URLDescription: 'File to download',
      MimeType: 'application/x-hdfeos',
      moreMetadataFields: 'somthingelse'
    }
  ];
  const newURLs = [
    {
      URL: 's3://path/to/metadata.cmr.xml',
      URLDescription: 'File to download'
    }
  ];
  const expected = [
    {
      URL: 's3://path/to/metadata.cmr.xml',
      URLDescription: 'File to download',
      MimeType: 'application/x-hdfeos',
      moreMetadataFields: 'somthingelse'
    }
  ];
  const deleted = [{ URL: 'does not exist'}];
  const actual = mergeURLs(originalURLs, newURLs, deleted);

  t.deepEqual(expected.sort(sortByURL), actual.sort(sortByURL));
});

test('Replaces an updated URL, but does not overwrite existing metadata fields.', (t) => {
  const originalURLs = [
    {
      URL: 'https://path/to/metadata.cmr.xml',
      URLDescription: 'File to download',
      MimeType: 'application/x-hdfeos'
    }
  ];
  const newURLs = [
    {
      URL: 's3://expected/to/change/path/to/metadata.cmr.xml',
      URLDescription: 'UPDATED METADATA TO BE IGNORED'
    }
  ];
  const expected = [
    {
      URL: 's3://expected/to/change/path/to/metadata.cmr.xml',
      URLDescription: 'File to download',
      MimeType: 'application/x-hdfeos'
    }
  ];

  const actual = mergeURLs(originalURLs, newURLs);

  t.deepEqual(expected.sort(sortByURL), actual.sort(sortByURL));
});

test('Replaces an updated URL and adds new metadata, but does not overwrite existing metadata.', (t) => {
  const originalURLs = [
    {
      URL: 'https://original/path/to/metadata.cmr.xml',
      URLDescription: 'File to download'
    }
  ];
  const newURLs = [
    {
      URL: 's3://new/path/to/metadata.cmr.xml',
      URLDescription: 'UPDATED METADATA TO BE IGNORED',
      Type: 'expected to add: GET DATA'
    }
  ];
  const expected = [
    {
      URL: 's3://new/path/to/metadata.cmr.xml',
      URLDescription: 'File to download',
      Type: 'expected to add: GET DATA'
    }
  ];

  const actual = mergeURLs(originalURLs, newURLs);

  t.deepEqual(expected.sort(sortByURL), actual.sort(sortByURL));
});

test('Does Complicated merging', (t) => {
  const originalURLs = [
    {
      URL: 'https://replaced/path/to/data.hdf',
      URLDescription: 'keep description: File to download',
      MimeType: 'keeps mimetype: application/x-hdfeos'
    },
    {
      URL: 'https://staging/path/to/data.hdf.met',
      URLDescription: 'File is made private and should be deleted'
    },
    {
      URL: 'https://replaced/path/to/metadata.cmr.xml',
      Type: 'keeps Type: ORIGINAL',
      MimeType: 'also from original: text/xml'
    },
    {
      URL: 'https://original/path/to/passthrough.jpg',
      Type: 'GET RELATED VISUALIZATION',
      MimeType: 'image/jpeg'
    }
  ];
  const newURLs = [
    {
      URL: 's3://new/path/to/metadata.cmr.xml',
      URLDescription: 'from Updated',
      Type: 'SHOULD BE IGNORED: GET DATA'
    },
    {
      URL: 's3://new/path/to/data.hdf',
      URLDescription: 'File to download',
      Type: 'adds type when missing: GET DATA'
    }
  ];
  const deletedURLs = [
    {
      URL: 'https://new/private/location/to/data.hdf.met'
    }
  ];

  const expected = [
    {
      URL: 's3://new/path/to/data.hdf',
      URLDescription: 'keep description: File to download',
      MimeType: 'keeps mimetype: application/x-hdfeos',
      Type: 'adds type when missing: GET DATA'
    },
    {
      URL: 'https://original/path/to/passthrough.jpg',
      Type: 'GET RELATED VISUALIZATION',
      MimeType: 'image/jpeg'
    },
    {
      URL: 's3://new/path/to/metadata.cmr.xml',
      URLDescription: 'from Updated',
      Type: 'keeps Type: ORIGINAL',
      MimeType: 'also from original: text/xml'
    }
  ];

  const actual = mergeURLs(originalURLs, newURLs, deletedURLs);

  t.deepEqual(expected.sort(sortByURL), actual.sort(sortByURL));
});
