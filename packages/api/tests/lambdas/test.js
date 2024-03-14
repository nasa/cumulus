const { s3PutObject, listS3ObjectsV2, deleteS3Object } = require('@cumulus/aws-client/S3');
const uuidv4 = require('uuid/v4');

async function do_this(){
    console.log("\n hello \n");
    const hello =  await s3PutObject({
        Bucket: 'cumulus-test-sandbox-internal',
        Key: `nnaga-ci-tf/dead-letter-archive/sqs/2024/3/14/18/test-${uuidv4()}.json`,
        Body: '',
    })
    console.log("\n hello2 \n");
    console.log(hello);
    console.log("\n hello3 \n");
    const hello2 = await listS3ObjectsV2({
        Bucket: 'cumulus-test-sandbox-internal',
        Prefix: 'nnaga-ci-tf/dead-letter-archive/sqs/2024/3/14/18/test'
    })


    console.log(hello2.length);
    console.log("\n hello4 \n");
}

do_this();