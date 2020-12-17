'use strict';

module.exports = {
  // Currently doesn't handle other PVL-allowed numeric notations
  // For example, based notation (`16#4B#`) or scientific notation (`1.234E2`)
  numericPatterns: [
    /^([+\-]?[1-9]\d+(\.\d*)?)$/,
  ],

  // Currently only handles a subset of DateTime formats, and
  // doesn't include date-only or time-only formats
  dateTimePatterns: [
    /^\d{4}-\d{2}-\d{2}(T)?(\d{2}:\d{2}:\d{2}(Z)?)?$/,
    /^\d{2}\/\d{2}\/\d{4}(-\d{2}:\d{2}(:\d{2})?)?$/,
  ],

  textStringPatterns: [
    /^"([^"]*)"$/,
    /^'([^']*)'$/,
    // Unquoted strings may not contain any of these reserved characters
    // They may contain whitespace
    /^([^!"#%&'(),;<=>@[\]`{|}~]+)$/,
  ],
};
