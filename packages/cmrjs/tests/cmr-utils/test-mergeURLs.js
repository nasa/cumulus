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

test('Replaces an updated URL, but keeps any additional metadata.', (t) => {
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

  const actual = mergeURLs(originalURLs, newURLs);

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
      URL: 's3://path/to/metadata.cmr.xml',
      URLDescription: 'UPDATED METADATA TO BE IGNORED'
    }
  ];
  const expected = [
    {
      URL: 's3://path/to/metadata.cmr.xml',
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
      Type: 'GET DATA'
    }
  ];
  const expected = [
    {
      URL: 's3://new/path/to/metadata.cmr.xml',
      URLDescription: 'File to download',
      Type: 'GET DATA'
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
      Type: 'SHOULD BE IGNORED BUT WAS ACTUALLY: GET DATA'
    },
    {
      URL: 's3://new/path/to/data.hdf',
      URLDescription: 'File to download',
      Type: 'adds type when missing: GET DATA'
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

  const actual = mergeURLs(originalURLs, newURLs);

  t.deepEqual(expected.sort(sortByURL), actual.sort(sortByURL));
});
