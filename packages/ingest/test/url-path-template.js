'use strict';

const test = require('ava');
const urlPathTemplate = require('../url-path-template');

test('test basic usage', (t) => {
  const urlPath = '/{file.bucket}/{file.name}';
  const context = {
    file: {
      bucket: 'example',
      name: 'file.hdf'
    }
  };

  const result = urlPathTemplate(urlPath, context);
  t.is(result, '/example/file.hdf');
});
