'use strict';

const aws = require('cumulus-common/aws');
const path = require('path');
const fs = require('fs');

/**
   * Get the contents of a PDR from a SIPS server (S3 bucket for now)
   * @param {string} s3Bucket The bucket from which to read the file
   * @param {string} s3Key The key for the file object
   * @return An object with keys `fileName` and `pdr`.
   */
exports.getPdr = async (s3Bucket, s3Key) => {
  await aws.downloadS3Files([{ Bucket: s3Bucket, Key: s3Key }], '/tmp');
  const fileName = path.basename(s3Key);
  const filePath = path.join('/tmp', fileName);
  const pdr = fs.readFileSync(filePath, 'utf8');
  return { fileName: fileName, pdr: pdr.toString() };
};

const downloadFiles = async (s3Bucket, paths) => {
}

/**
 * Downloads all the files listed in a PVL FileGroup object
 * @param {Client} client The client connected to the SIPS server
 * @param {*} downloadDir The place to put the downloaded files
 * @param {*} fileGroup A PVL FileGroup object
 * @return A promise that resolves to a list of downloaded files paths.
 */
const downloadFileGroup = async (client, downloadDir, fileGroup) => {
  const fileSpecs = fileGroup.objects('FILE_SPEC');
  const downloadPromises = fileSpecs.map(fileSpec => {
    const dir = fileSpec.get('DIRECTORY_ID').value;
    const archiveFileName = `${fileSpec.get('FILE_ID').value}.tgz`;
    return downloadFile(client, dir, downloadDir, archiveFileName);
  });

  return Promise.all(downloadPromises);
};
