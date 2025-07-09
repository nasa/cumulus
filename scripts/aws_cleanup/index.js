// eslint-disable-next-line node/no-extraneous-require
const moment = require('moment');
const { ec2 } = require('@cumulus/aws-client/services');

const shouldBeCleanedUp = (instanceObject) => {
  const timeoutKey = process.env.timeout_key || 'Rotate By';
  return instanceObject.Tags.reduce((ret, tag) => {
    if (tag.Key === timeoutKey) {
      if (moment(tag.value) < moment()) {
        return true;
      }
    }
    return ret;
  }, false);
};

const getInstancesToClean = async (client) => {
  const describeResponse = await client.describeInstances();
  const instances = describeResponse.Reservations.flatMap((reservation) => reservation.Instances);
  return instances.filter(shouldBeCleanedUp).map((instance) => instance.InstanceId);
};

const handler = async () => {
  const client = ec2();
  const toClean = await getInstancesToClean(client);
  const termination = await client.terminateInstances({
    InstanceIds: toClean,
  });
  return {
    statusCode: 200,
    message: `termination completed with response ${JSON.stringify(termination)}`,
  };
};

if (require.main === module) {
  handler(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}
