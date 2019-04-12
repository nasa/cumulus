'use strict';

const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const utils = require('kes').utils;
const yauzl = require('yauzl');

const { Lambda } = require('kes');

/**
 * A sub-class of the Kes Lambda class that changes
 * how kes handles Lambda function compression and
 * upload to S3.
 *
 * This sub-class adds cumulus-message-adapter to
 * lambdas defined in a Kes configuration file.
 */
class UpdatedLambda extends Lambda {
  /**
   * Override the main constructor to allow
   * passing the config object to the instance
   * of the class
   *
   * @param {Object} config - Kes config object
   */
  constructor(config) {
    super(config);
    this.config = config;
  }

  /**
   * Executes buildS3Path for all lambdas in a lambda configuration object
   *
   * Utilizes buildS3Path to populate bucket/hash values
   * in the config object for a template that runs following a nested template
   * that has already run the superclass 'process' method.
   *
   * @param {string} configKey - the configuration key with a lambda
   *   configuration object to be modified
   * @returns {void} returns nothing
   */
  buildAllLambdaConfiguration(configKey) {
    if (this.config[configKey]) {
      let lambdas = this.config[configKey];
      // if the lambdas is not an array but a object, convert it to a list
      if (!Array.isArray(this.config[configKey])) {
        lambdas = Object.keys(this.config[configKey]).map((name) => {
          const lambda = this.config[configKey][name];
          lambda.name = name;
          return lambda;
        });
      }
      lambdas.forEach((lambda) => this.buildS3Path(lambda));
    }
  }


  /**
   * Method adds hash value from each config.lambda to each
   * defined workflow lambda in config.workflowLambdas
   *
   * @returns {void} returns nothing
   */
  addWorkflowLambdaHashes() {
    Object.keys(this.config.lambdas).forEach((key) => {
      if ((key in this.config.workflowLambdas) && ('hash' in this.config.lambdas[key])) {
        this.config.workflowLambdas[key].hash = this.config.lambdas[key].hash;
      }
    });
  }

  /**
   * Copies the source code of a given lambda function, zips it, calculates
   * the hash of the source code and updates the lambda object with
   * the hash, local and remote locations of the code.
   *
   * @param {Object} lambda - the lambda object
   * @returns {Promise} returns the updated lambda object
   */
  async zipLambda(lambda) {
    // skip if the file with the same hash is zipped
    // and is a valid zip file
    if (await fs.pathExists(lambda.local)) {
      try {
        await (util.promisify(yauzl.open))(lambda.local); // Verify yauzl can open the .zip file
        return Promise.resolve(lambda);
      } catch (e) {
        console.log(`${lambda.local} is invalid and will be rebuilt`);
      }
    }

    let msg = `Zipping ${lambda.local}`;
    const fileList = [lambda.source];
    if (lambda.useMessageAdapter) {
      const kesFolder = path.join(this.config.kesFolder, 'build', 'adapter');
      fileList.push(kesFolder);
      msg += ' and injecting message adapter';
    }

    console.log(`${msg} for ${lambda.name}`);

    try {
      await utils.zip(lambda.local, fileList);
    } catch (e) {
      console.log(`Error zipping ${e}`);
      throw e;
    }

    return lambda;
  }

  getLambdaVersionFromPackageFile(sourceDir) {
    let packageJson = '{}';
    const JsonFilePath = `${sourceDir}/../package.json`;

    try {
      if (fs.existsSync(JsonFilePath)) {
        packageJson = fs.readFileSync(`${JsonFilePath}`);
      }
    } catch (e) {
      console.log(`Error reading package.json from ${JsonFilePath}`);
      throw (e);
    }
    const packageData = JSON.parse(packageJson);

    if (!packageData || !packageData.version) {
      return null;
    }
    return packageData.version;
  }

  /**
   * Overrides the default method to allow returning
   * the lambda function after s3 paths were built
   *
   * If a s3Source is used, only add remote and bucket values
   *
   * If a s3Source is used and a uniqueIdentifier is specified
   * add that value in place of a calculated hash
   *
   * @param {Object} lambdaArg - the Lambda object
   * @returns {Object} the updated lambda object
   */
  buildS3Path(lambdaArg) {
    const lambda = super.buildS3Path(lambdaArg);

    if (lambda.s3Source && lambda.s3Source.uniqueIdentifier) {
      const uniqueIdentifier = lambda.s3Source.uniqueIdentifier;
      if (!uniqueIdentifier.match(/^[a-z0-9]+$/)) {
        throw new Error(`Invalid uniqueIdentifier ${uniqueIdentifier} provided for lambda`);
      }
      lambda.hash = uniqueIdentifier;
      lambda.humanReadableIdentifier = uniqueIdentifier;
    } else {
      const lambdaVersion = this.getLambdaVersionFromPackageFile(lambda.source);
      lambda.humanReadableIdentifier = lambdaVersion || lambda.hash;
    }

    // adding the hash of the message adapter zip file as part of lambda zip file
    if (lambda.useMessageAdapter && UpdatedLambda.messageAdapterZipFileHash) {
      lambda.local = path.join(
        path.dirname(lambda.local),
        `${UpdatedLambda.messageAdapterZipFileHash}-${path.basename(lambda.local)}`
      );
      lambda.remote = path.join(
        path.dirname(lambda.remote),
        `${UpdatedLambda.messageAdapterZipFileHash}-${path.basename(lambda.remote)}`
      );
    }

    return lambda;
  }
}

module.exports = UpdatedLambda;

UpdatedLambda.messageAdapterZipFileHash = undefined;
