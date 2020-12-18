'use strict';

module.exports = {
  // Currently doesn't handle other PVL-allowed numeric notations
  // For example, based notation (`16#4B#`) or scientific notation (`1.234E2`)
  numericPatterns: [
    /^([+\-]?(([1-9]\d*)|0)(\.\d*)?)$/,
  ],

  // Currently handles the subset of DateTime formats specified in the PDR ICD
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
