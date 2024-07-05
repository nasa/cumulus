const { cloudwatchevents } = require('@cumulus/aws-client/services');
const { deleteS3Files, listS3ObjectsV2 } = require('@cumulus/aws-client/S3');
const { loadConfig } = require('../helpers/testUtils');

describe('Cleans up Test Resources', () => {
  let testConfig;

  beforeAll(async () => {
    testConfig = await loadConfig();
  });

  it('removes the test output', async () => {
    const params = {
      Bucket: testConfig.bucket,
      Prefix: `${testConfig.stackName}/test-output/`,
    };
    const s3list = await listS3ObjectsV2(params);
    const s3objects = s3list.map((obj) => ({ Bucket: testConfig.bucket, Key: obj.Key }));
    console.log(`\nDeleting ${s3objects.length} objects`);
    await deleteS3Files(s3objects);
  });

  it('cleans up the scheduled rules', async () => {
    const response = await cloudwatchevents().listRules({
      NamePrefix: `${testConfig.stackName}-custom`,
    });
    await Promise.all(response.Rules.map(
      async (rule) => {
        const targetsResponse = await cloudwatchevents().listTargetsByRule({
          Rule: rule.Name,
          EventBusName: rule.EventBusName,
        });
        const targetIds = targetsResponse.Targets.map(
          (target) => target.Id
        );
        await cloudwatchevents().removeTargets({
          Ids: targetIds,
          Rule: rule.Name,
          EventBusName: rule.EventBusName,
        });
        await cloudwatchevents().deleteRule({
          Name: rule.Name,
          EventBusName: rule.EventBusName,
        });
      }
    ));
  });
});
