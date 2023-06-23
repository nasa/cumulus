import * as errors from '@cumulus/errors';
import moment from 'moment';
import { s3 } from '@cumulus/aws-client/services';
import * as S3 from '@cumulus/aws-client/S3';
import * as log from '@cumulus/common/log';
import { ApiFile, DuplicateHandling } from '@cumulus/types';
import { FilePgModel, translatePostgresFileToApiFile, Knex } from '@cumulus/db';
import { RecordDoesNotExist } from '@cumulus/errors';

export interface EventWithDuplicateHandling {
  config: {
    collection: {
      duplicateHandling?: DuplicateHandling
    },
    duplicateHandling?: DuplicateHandling,
  },
  cumulus_config?: {
    cumulus_context?: {
      forceDuplicateOverwrite?: boolean
    }
  },
}

export interface File {
  bucket?: string,
  key?: string,
  fileName?: string,
  name?: string,
  filename?: string,
  size?: string
}

export interface MovedGranuleFile {
  bucket: string,
  key: string,
  name?: string
}

export interface MoveFileParams {
  source?: {
    Bucket: string,
    Key: string
  },
  target?: {
    Bucket: string,
    Key: string
  },
  file: File
}

export interface VersionedObject {
  Bucket: string,
  Key?: string,
  size?: number
}

/**
  * rename s3 file with timestamp
  *
  * @param {string} bucket - bucket of the file
  * @param {string} key - s3 key of the file
  * @returns {Promise} promise that resolves when file is renamed
  */
export async function renameS3FileWithTimestamp(
  bucket: string,
  key: string
): Promise<void> {
  const formatString = 'YYYYMMDDTHHmmssSSS';
  const timestamp = (await S3.headObject(bucket, key)).LastModified;

  if (!timestamp) {
    throw new Error(`s3://${bucket}/${key} does not have a LastModified property`);
  }

  let renamedKey = `${key}.v${moment.utc(timestamp).format(formatString)}`;

  // if the renamed file already exists, get a new name
  // eslint-disable-next-line no-await-in-loop
  while (await S3.s3ObjectExists({ Bucket: bucket, Key: renamedKey })) {
    renamedKey = `${key}.v${moment.utc(timestamp).add(1, 'milliseconds').format(formatString)}`;
  }

  log.debug(`renameS3FileWithTimestamp renaming ${bucket} ${key} to ${renamedKey}`);

  await S3.moveObject({
    sourceBucket: bucket,
    sourceKey: key,
    destinationBucket: bucket,
    destinationKey: renamedKey,
    copyTags: true,
  });
}

/**
  * get all renamed s3 files for a given bucket and key
  *
  * @param {string} bucket - bucket of the file
  * @param {string} key - s3 key of the file
  * @returns {Array<Object>} returns renamed files
  */
export async function listVersionedObjects(
  bucket: string,
  key: string
): Promise<VersionedObject[]> {
  const s3list = await S3.listS3ObjectsV2({
    Bucket: bucket,
    Prefix: `${key}.v`,
  });

  if (s3list) {
    return s3list.map(({ Key, Size }) => ({
      Bucket: bucket,
      Key,
      size: Size,
    }));
  }
  return [];
}

/**
* Move granule file from one s3 bucket & keypath to another,
* creating a versioned copy of any file already existing at the target location
* and returning an array of the moved file and all versioned filenames.
*
* @param {Object} source - source
* @param {string} source.Bucket - source
* @param {string} source.Key - source
* @param {Object} target - target
* @param {string} target.Bucket - target
* @param {string} target.Key - target
* @param {Object} sourceChecksumObject - source checksum information
* @param {string} sourceChecksumObject.checksumType - checksum type, e.g. 'md5'
* @param {Object} sourceChecksumObject.checksum - checksum value
* @param {string} ACL - an S3 [Canned ACL](https://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html#canned-acl)
* @returns {Promise<Array>} returns a promise that resolves to a list of s3 version file objects.
*
* @private
**/
export async function moveGranuleFileWithVersioning(
  source: { Bucket: string, Key: string },
  target: { Bucket: string, Key: string },
  sourceChecksumObject: { checksumType?: string, checksum?: string } = {},
  ACL?: string
): Promise<VersionedObject[]> {
  const { checksumType, checksum } = sourceChecksumObject;
  // compare the checksum of the existing file and new file, and handle them accordingly
  const targetFileSum = await S3.calculateObjectHash({
    s3: s3(),
    algorithm: checksumType ?? 'CKSUM',
    bucket: target.Bucket,
    key: target.Key,
  });

  const sourceFileSum = checksum ?? await S3.calculateObjectHash({
    s3: s3(),
    algorithm: 'CKSUM',
    bucket: source.Bucket,
    key: source.Key,
  });

  // if the checksum of the existing file is the same as the new one, keep the existing file,
  // else rename the existing file, and both files are part of the granule.
  if (targetFileSum === sourceFileSum) {
    await S3.deleteS3Object(source.Bucket, source.Key);
  } else {
    log.debug(`Renaming ${target.Key}...`);
    await renameS3FileWithTimestamp(target.Bucket, target.Key);

    await S3.moveObject({
      sourceBucket: source.Bucket,
      sourceKey: source.Key,
      destinationBucket: target.Bucket,
      destinationKey: target.Key,
      copyTags: true,
      ACL,
    });
  }
  // return renamed files
  return listVersionedObjects(target.Bucket, target.Key);
}

/**
 * handle duplicate file in S3 syncs and moves
 *
 * @param {Object} params - params object
 * @param {Object} params.source - source object: { Bucket, Key }
 * @param {Object} params.target - target object: { Bucket, Key }
 * @param {string} params.ACL - an S3 [Canned ACL](https://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html#canned-acl)
 * @param {string} params.duplicateHandling - duplicateHandling config string
 * One of [`error`, `skip`, `replace`, `version`].
 * @param {Function} [params.checksumFunction] - optional function to verify source & target:
 * Called as `await checksumFunction(bucket, key);`, expected to return array where:
 * array[0] - string - checksum type
 * array[1] - string - checksum value
 * For example of partial application of expected values see `ingestFile` in this module.
 * @param {Function} [params.syncFileFunction] - optional function to sync file from non-s3 source.
 * Syncs to temporary source location for `version` case and to target location for `replace` case.
 * Called as `await syncFileFunction(bucket, key);`, expected to create file on S3.
 * For example of function prepared with partial application see `ingestFile` in this module.
 * @param {Function} [params.moveGranuleFileWithVersioningFunction] - optional -
 * override for moveGranuleFileWithVersioning.  Defaults to local module method
 * @param {Object} [params.s3Object] - optional - replacement for S3 import object,
 * intended for use in testing
 * @throws {DuplicateFile} DuplicateFile error in `error` case.
 * @returns {Array<Object>} List of file version S3 Objects in `version` case, otherwise empty.
 */
export async function handleDuplicateFile(params: {
  source: { Bucket: string, Key: string },
  target: { Bucket: string, Key: string },
  duplicateHandling: DuplicateHandling,
  checksumFunction?: (bucket: string, key: string) => Promise<[string, string]>,
  syncFileFunction?: (params: {
    destinationBucket: string,
    destinationKey: string,
    bucket?: string,
    fileRemotePath: string,
  }) => Promise<void>,
  ACL?: string,
  sourceBucket?: string,
  fileRemotePath: string,
  s3Object?: { moveObject: Function },
  moveGranuleFileWithVersioningFunction?: Function,
}): Promise<VersionedObject[]> {
  const {
    ACL,
    checksumFunction,
    duplicateHandling,
    fileRemotePath,
    moveGranuleFileWithVersioningFunction = moveGranuleFileWithVersioning,
    s3Object = S3,
    source,
    sourceBucket,
    syncFileFunction,
    target,
  } = params;

  if (duplicateHandling === 'error') {
    // Have to throw DuplicateFile and not WorkflowError, because the latter
    // is not treated as a failure by the message adapter.
    throw new errors.DuplicateFile(`${target.Key} already exists in ${target.Bucket} bucket`);
  } else if (duplicateHandling === 'version') {
    // sync to staging location if required
    if (syncFileFunction) {
      await syncFileFunction({
        bucket: sourceBucket,
        destinationBucket: source.Bucket,
        destinationKey: source.Key,
        fileRemotePath,
      });
    }
    let sourceChecksumObject = {};
    if (checksumFunction) {
      // verify integrity
      const [checksumType, checksum] = await checksumFunction(source.Bucket, source.Key);
      sourceChecksumObject = { checksumType, checksum };
    }
    // return list of renamed files
    return moveGranuleFileWithVersioningFunction(
      source,
      target,
      sourceChecksumObject,
      ACL
    );
  } else if (duplicateHandling === 'replace') {
    if (syncFileFunction) {
      // sync directly to target location
      await syncFileFunction({
        destinationBucket: target.Bucket,
        destinationKey: target.Key,
        bucket: sourceBucket,
        fileRemotePath,
      });
    } else {
      await s3Object.moveObject({
        ACL,
        copyTags: true,
        destinationBucket: target.Bucket,
        destinationKey: target.Key,
        sourceBucket: source.Bucket,
        sourceKey: source.Key,
      });
    }
    // verify integrity after sync/move
    if (checksumFunction) await checksumFunction(target.Bucket, target.Key);
  }
  // other values (including skip) return
  return [];
}

/**
 * Get the name of the file from the following properties (in order of preference):
 * 1. fileName (e.g. 'granuleFileNamec.md')
 * 2. name (e.g. 'granuleFileName.md')
 * 3. key (e.g. 'stackname/filepath/granuleFileName.md')
 * @param {File} file - file object with the above properties
 * @returns {string | undefined} - The file name as a string or undefined
 */
export const getNameOfFile = (file: File): string | undefined => {
  const fileName = file.fileName ?? file.name;

  if (!fileName) {
    return file.key?.split('/').pop();
  }

  return fileName;
};

/**
 * For each source file, see if there is a destination and generate the source
 * and target for the file moves.
 * @param {Array<Object>} sourceFiles - granule file objects
 * @param {Array<Object>} destinations - array of objects defining the destination of granule files
 * @returns {Array<Object>} - array containing the parameters for moving the file:
 *  {
 *    source: { Bucket, Key },
 *    target: { Bucket, Key },
 *    file: file object
 *  }
 */
export function generateMoveFileParams(
  sourceFiles: File[],
  destinations: {
    bucket: string,
    filepath?: string,
    regex: string | RegExp
  }[]
): MoveFileParams[] {
  return sourceFiles.map((file) => {
    const fileName = getNameOfFile(file);

    if (fileName === undefined) return { file };

    const destination = destinations.find((dest) => fileName.match(dest.regex));

    // if there's no match, we skip the file
    if (!destination) return { file };

    let source;
    if (file.bucket && file.key) {
      source = {
        Bucket: file.bucket,
        Key: file.key,
      };
    } else if (file.filename) {
      source = S3.parseS3Uri(file.filename);
    } else {
      throw new Error(`granule.generateMoveFileParams unable to determine location of file: ${JSON.stringify(file)}`);
    }

    const targetKey = destination.filepath
      ? `${destination.filepath}/${getNameOfFile(file)}`
      : getNameOfFile(file);

    if (targetKey === undefined) {
      return { file };
    }

    const target = {
      Bucket: destination.bucket,
      Key: targetKey,
    };

    return { source, target, file };
  });
}

/**
* Moves a granule file and updates the datastore accordingly
* @summary Moves a granule file record according to MoveFileParams and updates database accordingly
* @param {MoveFileParams} moveFileParam - Parameter object describing the move operation
* @param {FilePgModel} filesPgModel - FilePgModel instance
* @param {Knex.Transaction | Knex} trx - Knex transaction or (optionally) Knex object
* @param {number | undefined } postgresCumulusGranuleId - postgres internal granule id
* @returns {Promise<Object>} - Returns object of type Omit<ApiFile, 'granuleId>>
*/
export async function moveGranuleFile(
  moveFileParam: MoveFileParams,
  filesPgModel: FilePgModel,
  trx: Knex.Transaction | Knex,
  postgresCumulusGranuleId: number | undefined
): Promise<Omit<ApiFile, 'granuleId'>> {
  const { source, target, file } = moveFileParam;

  if (source && target) {
    log.debug('moveGranuleS3Object', source, target);
    if (!postgresCumulusGranuleId) {
      throw new Error('postgresCumulusGranuleId must be defined to move granule file if writeToPostgres is true');
    }
    const updatedPgRecords = await filesPgModel.update(
      trx,
      {
        granule_cumulus_id: postgresCumulusGranuleId,
        bucket: source.Bucket,
        key: source.Key,
      },
      {
        bucket: target.Bucket,
        key: target.Key,
        file_name: getNameOfFile(file),
      }, ['*']
    );
    if (updatedPgRecords.length !== 1) {
      throw new RecordDoesNotExist('Attempted to update granule on move, but granule does not exist');
    }
    const updatedPgRecord = updatedPgRecords[0];

    await S3.moveObject({
      sourceBucket: source.Bucket,
      sourceKey: source.Key,
      destinationBucket: target.Bucket,
      destinationKey: target.Key,
      copyTags: true,
    });

    return {
      ...translatePostgresFileToApiFile(updatedPgRecord),
      bucket: target.Bucket,
      key: target.Key,
      fileName: getNameOfFile({ key: target.Key }),
    };
  }

  if (!(file.bucket || file.key) && file.filename) {
    const parsed = S3.parseS3Uri(file.filename);
    file.bucket = parsed.Bucket;
    file.key = parsed.Key;
  }

  const postgresFileRecord = await filesPgModel.get(trx, {
    granule_cumulus_id: postgresCumulusGranuleId,
    bucket: file.bucket,
    key: file.key,
  });

  return translatePostgresFileToApiFile(postgresFileRecord);
}

/**
 * check to see if the file has the suffix with timestamp '.vYYYYMMDDTHHmmssSSS'
 *
 * @param {string} filename - name of the file
 * @returns {boolean} whether the file is renamed
 */
function isFileRenamed(filename: string): boolean {
  const suffixRegex = '\\.v[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[1-2][0-9]|3[0-1])T(2[0-3]|[01][0-9])[0-5][0-9][0-5][0-9][0-9]{3}$';
  return (filename.match(suffixRegex) !== null);
}

/**
 * Returns the input filename stripping off any versioned timestamp.
 *
 * @param {string} filename
 * @returns {string} - filename with timestamp removed
 */
export function unversionFilename(filename: string): string {
  return isFileRenamed(filename)
    ? filename.split('.').slice(0, -1).join('.')
    : filename;
}

/**
 * Returns a directive on how to act when duplicate files are encountered.
 *
 * @param {Object} event - lambda function event.
 * @param {Object} event.config - the config object
 * @param {Object} event.config.collection - collection object.

 * @returns {string} - duplicate handling directive.
 */
export function duplicateHandlingType(
  event: EventWithDuplicateHandling
): DuplicateHandling {
  if (event?.cumulus_config?.cumulus_context?.forceDuplicateOverwrite) {
    return 'replace';
  }

  return event.config.duplicateHandling
    ?? event.config.collection.duplicateHandling
    ?? 'error';
}
