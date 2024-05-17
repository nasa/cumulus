import minimist from 'minimist';
import moment from 'moment';
import { listS3ObjectsV2Batch } from '@cumulus/aws-client/S3';

interface UnitErrorArgs {
  prefix: string
  date: string
  bucket: string
}
const momentFormat = 'YYYY-MM-DDTHH.mm.ss';

//expects key in format <branch>/YYYY-mm-DDTHH.MM.SS/<error>.log
export const extractError = (key: string): string => key.split('/')?.pop()?.split('.')[0] || 'unknown';

export const extractDate = (key: string): string => {
  //expects key in format <branch>/YYYY-mm-DDTHH.MM.SS/<error>.log
  const keySegments = key.split('/');
  const out = moment(keySegments[keySegments.length - 2], momentFormat).format(momentFormat);
  return out;
};

export const getErrorLogs = async (
  branch: string = 'master',
  date: string,
  bucket: string = 'unit-test-error-logs'
): Promise<Array<any>> => {
  const objects: Array<any> = [];
  for await (
    const objectBatch of listS3ObjectsV2Batch({ Bucket: bucket, Prefix: branch })
  ) {
    if (objectBatch) {
      objectBatch.filter(
        (object) => object.Key && object.Key.endsWith('.log') && extractDate(object.Key) > date
      ).forEach((object) => objects.push(object.Key));
    }
  }
  return objects;
};

export const organizeByErrorType = (keys: Array<string>): { [key: string]: Array<string> } => {
  const mapping: { [key: string]: Array<string> } = {};
  keys.forEach((key) => {
    const error = extractError(key);
    if (!(error in mapping)) {
      mapping[error] = [];
    }
    mapping[error].push(key);
  });
  Object.values(mapping).forEach((list) => list.sort());
  return mapping;
};

export const organizeByDate = (keys: Array<string>): Array<Array<string>> => {
  const sortedList: Array<Array<string>> = [];
  keys.forEach((key) => {
    const error = extractError(key);
    const errorDate = extractDate(key);
    sortedList.push(
      [errorDate, error]
    );
  });
  sortedList.sort((a, b) => (a[0] > b[0] ? 1 : (a[0] < b[0] ? -1 : 0)));
  return sortedList;
};

export const processArgs = async (): Promise<UnitErrorArgs> => {
  const {
    prefix,
    date,
    bucket,
  } = minimist(
    process.argv,
    {
      string: ['prefix', 'date', 'bucket'],
      alias: {
        p: 'prefix',
        key: 'prefix',
        k: 'prefix',
        path: 'prefix',
        b: 'prefix',
        branch: 'prefix',
        d: 'date',
      },
      default: {
        prefix: 'master',
        date: undefined,
        bucket: 'unit-test-error-logs',
      },
    }
  );
  return {
    prefix,
    date: moment(date).format('YYYY-MM-DD'),
    bucket,
  };
};
const main = async () => {
  const {
    prefix,
    date,
    bucket,
  } = await processArgs();
  const keys = await getErrorLogs(prefix, date, bucket);
  console.log(organizeByDate(keys));
  console.log(organizeByErrorType(keys));
};

if (require.main === module) {
  main(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}
