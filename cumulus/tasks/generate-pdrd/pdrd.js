'use strict';

const aws = require('cumulus-common/aws');
const log = require('cumulus-common/log');
const pvl = require('pvl');
// const promisify = require('util.promisify');
// const stp = require('stream-to-promise');
const sts = require('string-to-stream');
const path = require('path');
const fs = require('fs');

exports.generatePdrd = (status) => {
  let pdrd = '';

  if (status.topLevelErrors & status.topLevelErrors.length > 0) {
    pdrd = `MESSAGE_TYPE = SHORTPDRD;
${status.topLevelErrors[0]}`;
  }
  else {
    pdrd = 'MESSAGE_TYPE = LONGPDRD;';
    pdrd += `NO_FILE_GRPS = ${status.fileGroupErrors.length}`;
  }

  status.fileGroupErrors.forEach(errors => {
    if (errors.length > 0) {
      pdrd += errors[0];
    }
    else {
      pdrd += 'SUCCESSFUL';
    }
  });
};
