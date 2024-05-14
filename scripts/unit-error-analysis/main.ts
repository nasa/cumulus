import minimist from 'minimist';

import { listS3ObjectsV2Batch } from "@cumulus/aws-client/S3";

interface UnitErrorArgs {
  prefix: string
  date: Date
}

const parseDate = (
  year?: number,
  month?: number,
  day?: number,
): Date => {
  const today = new Date();
  // js month is 0 indexed
  const parsedMonth = month ? month - 1 : today.getMonth();
  const parsedDay = day ? day : today.getDay();
  let parsedYear = year;
  if(!parsedYear){
    parsedYear = new Date().getFullYear();
    if (new Date(today.getFullYear(), parsedMonth, parsedDay) > today){
      parsedYear -= 1;
    }
  }
  return new Date(parsedYear, parsedMonth, parsedDay);
}

const getKeys = async (
  branch: string = "master",
  date: Date,
): Promise<Array<any>> => {
  const objects: Array<any> = [];
  for await (
    const objectBatch of listS3ObjectsV2Batch({ Bucket: 'unit-test-error-logs', Prefix: branch })
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
    const errorDate = segments.pop();
    if(!errorDate) return;
    if(!(errorPoint in mapping)) {
      mapping[errorPoint] = [];
    }
    mapping[errorPoint].push(errorDate);
  })
  Object.values(mapping).forEach((list) => list.sort());
  console.log(mapping);
}; 

export const processArgs = async (): Promise<UnitErrorArgs> => {
  const {
    prefix,
    year,
    month,
    day,
    date,
  } = minimist(
    process.argv,
    {
      string: ['prefix', 'year', 'month', 'day', 'date'],
      alias: {
        p: 'prefix',
        key: 'prefix',
        k: 'prefix',
        path: 'prefix',
        b: 'prefix',
        branch: 'prefix',
        y: 'year',
        m: 'month',
        d: 'day'
      },
      default: {
        prefix: 'master',
        year: undefined,
        month: undefined,
        day: undefined,
        date: undefined
      },
    }
  );
  const parsedDate = date ? new Date(date) : parseDate(year, month, day);
  return {
    prefix,
    date: parsedDate,
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
