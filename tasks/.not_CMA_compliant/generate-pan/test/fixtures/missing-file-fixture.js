'use strict';

exports.input = [
  {
    source: {
      url: 'ftp.localhost/file1'
    },
    success: false,
    error: 'The file did not exist at the source.'
  },
  {
    source: {
      url: 'ftp.localhost/file2'
    },
    success: true
  }
];
