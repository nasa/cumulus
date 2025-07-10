// eslint-disable-next-line node/no-extraneous-require
const moment = require('moment');
const { ec2 } = require('@cumulus/aws-client/services');

const shouldBeCleanedUp = (instanceObject, todayFunc) => {
  const timeoutKey = process.env.timeout_key || 'Rotate By';
  return instanceObject.Tags.reduce((ret, tag) => {
    if (tag.Key === timeoutKey && moment(tag.Value) < todayFunc()) {
      return true;
    }
    return ret;
  }, false);
};

const getInstancesToClean = async (client) => {
  const describeResponse = await client.describeInstances();
  const instances = describeResponse.Reservations.flatMap((reservation) => reservation.Instances);
  return instances.filter((instance) =>
    shouldBeCleanedUp(instance, moment)
  ).map((instance) => instance.InstanceId);
};

const handler = async () => {
  const client = ec2();
  const toClean = await getInstancesToClean(client);
  if (toClean.length) {
    const termination = await client.terminateInstances({
      InstanceIds: toClean,
    });
    return {
      statusCode: 200,
      message: `termination completed with response ${JSON.stringify(termination)}`,
    };
  }
  return {
    statusCode: 200,
    message: `termination completed with no instances out of date`,
  };
};

module.exports = {
  shouldBeCleanedUp,
  handler
}

if (require.main === module) {
  handler(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}
