'use strict';

import path from 'path';
import url from 'url';
import get from 'lodash.get';
import log from '@cumulus/common/log';
import { createErrorType } from '@cumulus/common/errors';
import { S3 } from '@cumulus/common/aws-helpers';

/**
 * The error object for when payload files are not provided
 * @class
 */
const PayloadFilesNotFound = createErrorType('PayloadFilesNotFound');

const logDetails = {
  file: 'lambda/archive/index.js',
  source: 'archiver',
  type: 'processing'
};

async function archive(files, fileDefinitions) {
  // only copy public and protected files
  // keep all the files in the staging folder (need to be moved later on)
  const newFiles = {};
  for (const element of Object.entries(files)) {
    const key = element[0];
    const uri = element[1];

    // if the file is on S3, apply archive


    if (file.stagingFile) {
      let bucket;
      let isPublic = false;
      switch (file.access) {
        case 'protected':
          bucket = process.env.protected;
          break;
        case 'public':
          bucket = process.env.public;
          isPublic = true;
          break;
        default:
          bucket = process.env.private;
          break;
      }

      const p = url.parse(file.stagingFile);
      const filename = path.basename(p.path);

      log.info(`${filename} copied`, logDetails);
      await S3.copy(path.join(p.host, p.path), bucket, filename, isPublic);

      // delete the file from staging
      const deleteInfo = S3.parseS3Uri(file.stagingFile);
      await S3.delete(deleteInfo.Bucket, deleteInfo.Key);
      log.info(`${file.stagingFile} deleted`, logDetails);

      file.archivedFile = `s3://${bucket}/${filename}`;
      file.name = filename;
    }

    newFiles[key] = file;
  }

  return newFiles;
}

export function handler(event, context, cb) {
  logDetails.collectionName = get(event, 'collection.id');
  logDetails.pdrName = get(event, 'payload.pdrName');
  logDetails.granuleId = get(event, 'payload.granuleId');

  // make sure files are included in the payload
  const files = get(event, 'payload.files');
  if (!files) {
    const err = new PayloadFilesNotFound('Files were not found in the payload');
    return cb(err);
  }

  // make sure file definitions are included in the collection meta
  const fileDefinitions = get(event, 'collection.meta.files');
  if (!fileDefinitions) {
    const err = new PayloadFilesNotFound('File definitions were not found in the collection.meta');
    return cb(err);
  }

  log.info('Started archiving', logDetails);
  log.debug('Started file copy', logDetails);

  archive(files, fileDefinitions).then((newFiles) => {
    log.info('All files archived', logDetails);

    event.payload.files = newFiles;
    return event;
  }).then((r) => {
    cb(null, r);
  }).catch((e) => {
    log.error(e, e.stack, logDetails);
    cb(e.stack);
  });
}

