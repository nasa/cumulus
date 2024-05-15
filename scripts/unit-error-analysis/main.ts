import minimist from 'minimist';

import { listS3ObjectsV2Batch } from "@cumulus/aws-client/S3";

interface UnitErrorArgs {
  prefix: string
  date: Date
}

const getKeys = async (
  branch: string = "master",
  date: Date,
): Promise<Array<any>> => {
  const objects: Array<any> = [];
  for await (
    const objectBatch of listS3ObjectsV2Batch({ Bucket: 'unit-test-error-logs-example', Prefix: branch })
  ) {
    if (objectBatch){
      objectBatch.filter(
        (object) => object.LastModified && object.Key && object.Key.endsWith('.log') && object.LastModified > date
      ).forEach((object) => objects.push(object.Key));
    }
  }
  return objects;
}

const analyzeKeys = async (keys: Array<string>) => {
  const mapping: {[key:string]: Array<string>} = {}
  keys.forEach((key) => {
    const segments = key.split('/')
    if(!segments) return;
    const errorPoint = segments.pop()?.split('.')[0];
    if(!errorPoint) return;
    if(!(errorPoint in mapping)) {
      mapping[errorPoint] = [];
    }
    mapping[errorPoint].push(key);
  })
  Object.values(mapping).forEach((list) => list.sort());
  console.log(mapping);
  const sortedList: Array<Array<string>> = [];
  keys.forEach((key) => {
    const segments = key.split('/')
    if(!segments) return;
    const errorPoint = segments.pop()?.split('.')[0];
    if(!errorPoint) return;
    const errorDate = segments.pop();
    if(!errorDate) return;
    sortedList.push(
      [errorDate, errorPoint]
    );
  })
  sortedList.sort((a, b)=> a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0);
  console.log(sortedList);
}; 

export const processArgs = async (): Promise<UnitErrorArgs> => {
  const {
    prefix,
    date,
  } = minimist(
    process.argv,
    {
      string: ['prefix', 'date'],
      alias: {
        p: 'prefix',
        key: 'prefix',
        k: 'prefix',
        path: 'prefix',
        b: 'prefix',
        branch: 'prefix',
        d: 'date'
      },
      default: {
        prefix: 'master',
        date: undefined
      },
    }
  );
  return {
    prefix,
    date: date ? new Date(date) : new Date(),
  };
};
const main = async () => {
  const {
    prefix,
    date
  } = await processArgs();
  const keys = await getKeys(prefix, date);
  analyzeKeys(keys);

};

if (require.main === module) {
  main(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
};
