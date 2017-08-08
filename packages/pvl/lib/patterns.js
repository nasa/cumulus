'use strict';

module.exports = {
  // Currently doesn't handle other PVL-allowed numeric notations
  // For example, based notation (`16#4B#`) or scientific notation (`1.234E2`)
  numericPatterns: [
    /^([\-\+]?[\d]+(\.\d*)?)$/
  ],

  // Currently only handles a subset of DateTime formats, and
  // doesn't include date-only or time-only formats
  dateTimePatterns: [
    /^(\d[\d\-:TZ\+]+)$/
  ],

  textStringPatterns: [
    /^"([^"]*)"$/,
    /^'([^']*)'$/,
    // Unquoted strings may not contain any of these reserved characters
    // They may contain whitespace
    /^([^!"#%&'\(\),;<=>@\[\]`\{\|\}~]+)$/
  ]
};
