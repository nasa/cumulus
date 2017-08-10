'use strict';

const path = require('path');

/**
 * Map of error messages from Provider Gateway to accepted dispositions for PANs
 */
const errorMessageToDisposition = {
  'The file did not exist at the source.': 'NETWORK FAILURE'
};

/**
 * Generate the text of a PAN file for the given file download dispositions
 * @param {Array} files An array of objects representing the files that were downloaded.
 */
exports.generatePan = (files, timeStamp) => {
  let pan = 'MESSAGE_TYPE = LONGPAN;\n';

  let allSuccess = true;

  pan += `NO_OF_FILES = ${files.length};\n`;

  files.forEach(file => {
    const fileName = file.source.url.substring(file.source.url.lastIndexOf('/') + 1);
    const filePath = file.source.url.substring(file.source.url.lastIndexOf(':') + 3);
    const fileDirectory = path.dirname(filePath);
    pan += `FILE_DIRECTORY = ${fileDirectory};\n`;
    pan += `FILE_NAME = ${fileName};\n`;
    let disposition = 'SUCCESSFUL';
    if (!file.success) {
      allSuccess = false;
      disposition = errorMessageToDisposition[file.error] || file.error;
    }
    pan += `DISPOSITION = "${disposition}";\n`;
    pan += `TIME_STAMP = ${timeStamp};\n`;
  });

  // Generate a short PAN if all the files were successful
  if (allSuccess) {
    pan =
`MESSAGE_TYPE = SHORTPAN;
DISPOSITION = "SUCCESSFUL";
TIME_STAMP = ${timeStamp};`;
  }

  return pan;
};
