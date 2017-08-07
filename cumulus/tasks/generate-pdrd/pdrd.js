'use strict';

const log = require('cumulus-common/log');

exports.generatePdrd = (topLevelErrors, fileGroupErrors) => {
  let pdrd = '';

  if (topLevelErrors & topLevelErrors.length > 0) {
    pdrd = `MESSAGE_TYPE = SHORTPDRD;
${topLevelErrors[0]}`;
  }
  else {
    pdrd = 'MESSAGE_TYPE = LONGPDRD;\n';
    pdrd += `NO_FILE_GRPS = ${fileGroupErrors.length}\n`;
  }

  fileGroupErrors.forEach(errors => {
    if (errors.length > 0) {
      pdrd += errors[0];
    }
    else {
      pdrd += 'SUCCESSFUL\n';
    }
  });

  return pdrd;
};
