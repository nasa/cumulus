'use strict';

const { randomStringFromRegex } = require('@cumulus/common/test-utils');
const Logger = require('@cumulus/logger');

const { fetchFakeProviderIp } = require('@cumulus/common/fake-provider');
const replace = require('lodash/replace');
const JSFtp = require('jsftp');
const path = require('path');
const fs = require('fs');

const log = new Logger({
  sender: '@cumulus/example/lambdas/ftpPopulateTestLambda',
});

const updateAndUploadTestFileToFtpHost = (params) => {
  const {
    file,
    hostConfig,
    prefix,
    replacements = [],
    targetReplacementRegex,
    targetReplacementString,
  } = params;
  let data = fs.readFileSync(file);
  if (replacements.length > 0) {
    replacements.forEach((replacement) => {
      data = replace(data, new RegExp(replacement.old, 'g'), replacement.new);
    });
  }
  let key = path.basename(file);
  if (targetReplacementRegex) {
    key = key.replace(targetReplacementRegex, targetReplacementString);
  }

  log.info(`Hostconfig ${JSON.stringify(hostConfig)}`);

  const ftp = new JSFtp(hostConfig);

  log.info(`Getting ready for ftp put ${prefix}/${key}`);

  try {
    // Upload buffer to FTP site
    return new Promise((resolve, reject) => {
      ftp.on('error', reject);
      ftp.raw('mkd', prefix, () => {
        ftp.put(data, `${prefix}/${key}`, (suberr) => {
          if (suberr) {
            reject(suberr);
          }
          ftp.destroy();
          resolve(`${prefix}/${key}`);
        });
      });
    });
  } catch (error) {
    log.info('Error on updateAndUploadTestFileToFtpHost', error);
    throw error;
  }
};

const uploadFtpGranuleDataForDiscovery = async ({ prefix }) => {
  log.info('Starting lambda');
  const ftpData = [
    './granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf.met',
    './granules/MOD09GQ.A2016358.h13v04.006.2016360104606.hdf',
    './granules/MOD09GQ.A2016358.h13v04.006.2016360104606_ndvi.jpg',
  ];
  const granuleRegex = '^MOD09GQ\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';
  const newGranuleId = randomStringFromRegex(granuleRegex);

  const hostConfig = {
    host: await fetchFakeProviderIp(),
    user: 'testuser',
    pass: 'testpass',
  };

  log.info(`Hostconfig is ${JSON.stringify(hostConfig)}`);

  const filePaths = await Promise.all(
    ftpData.map(async (file) => {
      let objectKey;
      try {
        objectKey = await updateAndUploadTestFileToFtpHost({
          file,
          hostConfig,
          prefix,
          targetReplacementRegex: 'MOD09GQ.A2016358.h13v04.006.2016360104606',
          targetReplacementString: newGranuleId,
        });
      } catch (error) {
        log.info('Error!', error);
        throw error;
      }
      return objectKey;
    })
  );
  log.info(JSON.stringify(filePaths));
  return { filePaths, newGranuleId };
};

const deleteFtpGranule = async (filePath) => {
  const hostConfig = {
    host: await fetchFakeProviderIp(),
    user: 'testuser',
    pass: 'testpass',
  };
  const ftp = new JSFtp(hostConfig);

  // Delete files from FTP volume
  return new Promise((resolve, reject) => {
    ftp.on('error', reject);
    ftp.raw('dele', filePath, (err) => {
      ftp.destroy(filePath);
      if (err) {
        log.info(`Failed to delete file ${filePath}`, err);
        reject(err);
      }
      resolve(filePath);
    });
  });
};

const deleteFtpGranules = async ({ filePaths }) => {
  const deletions = await Promise.allSettled(
    filePaths.map((ftpFilePath) => deleteFtpGranule(ftpFilePath))
  );
  log.info(deletions);
  return deletions;
};

const handler = async (event, _context) => {
  log.info(event);
  if (event.command === 'delete') {
    return await deleteFtpGranules(event);
  }
  return await uploadFtpGranuleDataForDiscovery(event);
};

module.exports = { handler };
