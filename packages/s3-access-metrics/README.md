# S3 Server Access Logs to Cloudwatch Metrics

This package will take
[S3 Server Access Logs](https://docs.aws.amazon.com/AmazonS3/latest/dev/ServerLogs.html)
and write them out to Cloudwatch Metrics.

## How it works

When deployed, this will configure a trigger which watches a specified S3 bucket
for the arrival of new S3 Server Access Logs. When a new log file is uploaded,
it invokes a Lambda function which parses that log file and writes the number of
successful and failed GET.OBJECT requests to Cloudwatch Metrics.

The metrics will be available in Cloudwatch under:

* `Namespace`: CumulusDistribution
* `Metric names`: `SuccessCount` & `FailureCount`
  * Any S3 request event in the log with a status of 200 will be reported under
    `SuccessCount`. Any other status code will be reported under `FailureCount`.
* `Dimensions`: `Stack` = the stack name specified at deployment time

## Deployment Configuration

Before deployment, a `config.yml` must be created.

**Required Parameters**

* `prefix` - a unique prefix to be applied to the CloudFormation stack name, and
  to any named resources that will be created.
* `logsBucket` - the S3 bucket where the S3 AccessLogs are being written
* `stack` - the name of the Cumulus stack associated with this deployment

**Optional Parameters**

* `logsPrefix` - the S3 key prefix of the S3 AccessLogs
* `deploymentBucket` - the bucket to store deployment artifacts in. If not
  specified, a bucket will be created and used
* `permissionsBoundary` - an IAM permissions boundary to be used when managing
  IAM resources during deployment
* `vpcId` - the VPC to deploy Lambda functions to. If this is set, `subnetIds`
  must also be set
* `subnetIds` - a list of subnets to deploy Lambda functions to. If this is set,
  `vpcId` must also be set

**Example config.yml**

```yaml
prefix: my-prefix
logsBucket: my-logs-bucket
logsPrefix: path/to/my/logs/
stack: my-cumulus-stack
deploymentBucket: my-deployment-bucket
permissionsBoundary: arn:aws:iam::123456789012:policy/SomeRoleBoundary
vpcId: vpc-123
subnetIds:
  - subnet-123
  - subnet-456
```

## Deployment

The `s3-access-metrics` package is deployed using the
[Serverless Framework](https://serverless.com/framework/docs/providers/aws/guide/).

Deployment has only been tested using Node 8.10.

These instructions assume that you have [Node.js](https://nodejs.org/)
installed. If you don't, the easiest way to install it is typically to use the [Node Version Manager](https://github.com/nvm-sh/nvm).
Installation instructions for installing `nvm` can be found [here](https://github.com/nvm-sh/nvm#installation-and-update).
Once `nvm` has been installed, node v8.10 can be installed by running
`nvm install 8.10`, followed by `nvm use 8.10`.

**Deployment steps**

If you have not done so already, create a `config.yml` file. Once you have a
config file, deployment should be as simple as running:

1. `git clone https://github.com/nasa/cumulus.git`
1. `cd cumulus/packages/s3-access-metrics`
1. `npm install`
1. `./node_modules/.bin/sls deploy`
1. `./node_modules/.bin/sls s3deploy`

The output of the `sls deploy` command should display the name of the Lambda
function. If you view that Lambda function in the AWS Console, you should see an
"S3" trigger in the Designer view. Clicking on S3 will display the bucket and
prefix that the function is configured to trigger off of.
