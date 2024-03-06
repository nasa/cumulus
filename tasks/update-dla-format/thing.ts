// import { hoistCumulusMessageDetails } from '@cumulus/message/DeadLetterMessage';
// import {
//   getJsonS3Object,
//   putJsonS3Object,
//   createS3Buckets,

// } from '@cumulus/aws-client/S3';
import * as minimist from 'minimist';
// const updateDLAFile = async (bucket: string, path: string) => {
//   const newBucket = bucket + 'new_dla';
//   const dlaObject = getJsonS3Object(bucket, path);

//   const hoisted = hoistCumulusMessageDetails(dlaObject);
//   return putJsonS3Object(newBucket, path, hoisted);
// };

if (require.main === module) {
  const args = minimist(
    process.argv,
    {
      string: ['b'],
    }
  );
  console.log(args);
}

