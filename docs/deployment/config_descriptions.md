---
id: config_descriptions
title: Configuration Descriptions
hide_title: true
---

# Cumulus Configuration

## Overview

The table below provides an overview of the `config.yml` variables.
Note that entries delimited as \<name\> are intended to be read as objects where `name` is the key, not the value, e.g.:

```yaml
# Config for 'dynamos.\<name\>.read' where `name = UsersTable`
dynamos:
  UsersTable:
    read: 5
```

### config.yml Explained

| field | default     | description
| ----- | ----------- | -----------
| prefix | (required) | the name used as a prefix in all aws resources
| prefixNoDash | (required) | prefix with no dash
| users | | List of URS usernames permitted to access the Cumulus dashboard/API
| urs_url | `https://uat.urs.earthdata.nasa.gov/` | URS url used for OAuth
| useNgapPermissionBoundary | false | Required to be `true` when deploying to the NGAP platform
| useWorkflowLambdaVersions | true | Version deployed lambdas when they are updated.
| cmr.username | (required) | the username used for posting metadata to CMR
| cmr.provider | CUMULUS | the provider used for posting metadata to CMR
| cmr.clientId | CUMULUS | the clientId used to authenticate with the CMR
| cmr.password | (required) | the password used to authenticate with the CMR
| buckets | (required) | Configuration of buckets with key, bucket name, and type (i.e. internal, public private)
| system_bucket | `buckets.internal.name` | the bucket used for storing deployment artifacts
| shared_data_bucket | cumulus-data-shared | bucket containing shared data artifacts
| ems.provider | CUMULUS | the provider used for sending reports to EMS
| vpc.vpcId | (required if ecs is used) | the vpcId used with the deployment
| vpc.subnets | (required) | the subnets used
| vpc.securityGroup | (required) | security group ID to be used by Cumulus resources, must allow inbound HTTP(S) access (Port 443), optionally may allow SSH to access ECS instances.
| ecs.amiid | ami-9eb4b1e5 | amiid of an optimized ecs instance (different for each region)
| ecs.instanceType | (required) | the instance type of the ec2 machine used for running ecs tasks
| ecs.volumeSize | 50 | the storage on ec2 instance running the ecs tasks
| ecs.availabilityZone | us-east-1a | the availability zone used for launching ec2 machines
| ecs.minInstances | 1 | min number of ec2 instances to launch in an autoscaling group
| ecs.desiredInstances | 1 | desired number of ec2 instances needed in an autoscaling group
| ecs.maxInstances | 2 | max number of ec2 instances to launch in an autoscaling group
| es.name | es5 | name of the elasticsearch cluster
| es.elasticSearchMapping | 4 | version number of the elasticsearch mapping used
| es.version | 5.3 | elasticsearch software version
| es.instanceCount | 1 | number of elasticsearch nodes
| es.instanceType | t2.small.elasticsearch | size of the ec2 instance used for the elasticsearch
| es.volumeSize | 35 | the storage used in each elasticsearch node
| sns.\<name\> | | name of the sns topic
| sns.\<name\>.subscriptions.\<subscription_name\>.endpoint | | lambda function triggered for each message in the topic (see `@cumulus/deployment/app/config.yml` for examples of core usage)
| apis.\<name\> | | name of the apigateway application
| apiStage | dev | stage name used for each api gateway deployment stage
| api_backend_url | | (Override) Alternate API backend url
| api_distribution_url | | (Override) Alternate API url used for file distribution
| dynamos.\<name\> | | name of the dynamoDB table
| dynamos.\<name\>.read | 5 | number of reads per second
| dynamos.\<name\>.write | 1 | number of writes per second
| dynamos.\<name\>.attributes | | list of attributes
| sqs.\<name\> | | name of the queue
| sqs.\<name\>.visibilityTimeout | 20 | # of seconds the message returns to the queue after it is read by a consumer
| sqs.\<name\>.retry | 30 | number of time the message is returned to the queue before being discarded
| sqs.\<name\>.consumer | | list of lambda function queue consumer objects (see `@cumulus/deployment/app/config.yml` for examples of core usage)
| rules.\<name\> | | list of cloudwathch rules
| rules.\<name\>.schedule | | rule's schedule
| rules.\<name\>.state | ENABLED | state of the rule
| rules.\<name\>.targets | | list of lambda functions to be invoked (e.g. `- lambda: myFunctionName`)
| stepFunctions | | list of step functions
| lambdas | | list of lambda functions
| iams | | (Override) IAM roles if ARNs do not match conventions (See [below](config_descriptions#iams)).
| \<stack\>.params | | (Override) Parameters provided to Cumulus CloudFormation templates.

## Detailed Field Descriptions

### Deployment name (key)

The name (e.g. `dev:`) of the the 'deployment' - this key tells kes which configuration set (in addition to the default values) to use when creating the cloud formation template[^1]

### prefix

This value (e.g. `prefix: myPrefix`) will prefix CloudFormation-created resources and permissions.

### prefixNoDash

A representation of the stack name prefix that has dashes removed. This will be used for components that should be associated with the stack but do not allow dashes in the identifier.

### buckets

The buckets should map to the same names you used when creating buckets in the [Create S3 Buckets](deployment-readme#create-s3-buckets) step. Buckets are defined in the config.yml with a key, name, and type. Types should be one of: internal, public, private, or protected. Multiple buckets of each type can be configured. A key is used for the buckets to allow for swapping out the bucket names easily.

### useNgapPermissionBoundary

If deploying to a NASA NGAP account, set `useNgapPermissionBoundary: true`.

### vpc

Configure your virtual private cloud.  You can find the VPC Id, subnets, and security group values on the [VPC Dashboard](https://console.aws.amazon.com/vpc/home?region=us-east-1#). `vpcId` from [Your VPCs](https://console.aws.amazon.com/vpc/home?region=us-east-1#vpcs:), and `subnets` [here](https://console.aws.amazon.com/vpc/home?region=us-east-1#subnets:). When you choose a subnet, be sure to also note its availability zone, which is used to configure `ecs`. The security group MUST allow HTTP(S) traffic (port 443). Optionally, SSH traffic should be allowed to SSH into ECS instances.

Note: The console links are specific to `us-east-1`. Use the corresponding links for your region.

### cmr

Configuration is required for Cumulus integration with CMR services. The most obvious example of this integration is the `PostToCmr` Cumulus [task](https://github.com/nasa/cumulus/tree/master/tasks/post-to-cmr).

Ensure your CMR username/password is included in your `app/.env` file, as noted in the [deployment documentation](./deployment-readme):

```shell
CMR_USERNAME=cmruser
CMR_PASSWORD=cmrpassword
```

These values will be imported via kes in your configuration file.   You should ensure your `app/config.yml` contains the following lines:

```yaml
cmr:
  username: '{{CMR_USERNAME}}'
  provider: '<replace-with-cmr-provider>'
  clientId: '<replace-with-daac-name>-{{prefix}}'
  password: '{{CMR_PASSWORD}}'
```

`clientId` and `provider` should be configured to point to a user specified CMR `clientId` and `provider`. We use the `CUMULUS` provider in our configurations, but users can specify their own.

### users

List of EarthData users you wish to have access to your dashboard application. These users will be populated in your `<prefix>-UsersTable` [DynamoDb](https://console.aws.amazon.com/dynamodb/) table.

### ecs

Configuration for the Amazon EC2 Container Service (ECS) instance.  Update `availabilityZone` (or `availabilityZones` if using multiple AZs) with information from [VPC Dashboard](https://console.aws.amazon.com/vpc/home?region=us-east-1#)
note `instanceType` and `desiredInstances` have been selected for a sample install.  You will have to specify appropriate values to deploy and use ECS machines.   See [EC2 Instance Types](http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-types.html) for more information.

Also note, if you dont specify the `amiid`, it will try to use a default, which
may or may not exist. The default AMI is an NGAP-approved AMI. The most recent
NGAP AMI can be found using
[these instructions](https://wiki.earthdata.nasa.gov/display/ESKB/Select+an+NGAP+Created+AMI).

For each service, a TaskCountLowAlarm alarm is added to check the RUNNING Task Count against the service configuration.  You can update `ecs` properties and add additional ECS alarms to your service.  For example,

    ecs:
      services:
        EcsTaskHelloWorld:
          alarms:
            TaskCountHigh:
              alarm_description: 'There are more tasks running than the desired'
              comparison_operator: GreaterThanThreshold
              evaluation_periods: 1
              metric: MemoryUtilization
              statistic: SampleCount
              threshold: '{{ecs.services.EcsTaskHelloWorld.count}}'

#### Cluster AutoScaling

Cumulus ECS clusters have the ability to scale out and in based on
[CPU and memory reservations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cloudwatch-metrics.html#cluster_reservation).
There are a few configuration values that affect how the ECS cluster instances
scale:

* `ecs.clusterAutoscaling.scaleInThresholdPercent`: the reservation percentage
  where, if both CPU and memory are under, the EC2 cluster will be scaled in
* `ecs.clusterAutoscaling.scaleInAdjustmentPercent`: the percentage to increase
  or decrease the number of EC2 instances in the cluster when the "scale in"
  alarm is triggered. Since this is a "scale in" setting, it should typically be
  a negative value. For more information see the
  [PercentChangeInCapacity documentation](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-simple-step.html#as-scaling-adjustment),
  specifically the section on `PercentChangeInCapacity`.
* `ecs.clusterAutoscaling.scaleOutThresholdPercent`: the reservation percentage
  where, if both CPU and memory are under, the EC2 cluster will be scaled out
* `ecs.clusterAutoscaling.scaleOutAdjustmentPercent`: the percentage to increase
  or decrease the number of EC2 instances in the cluster when the "scale out"
  alarm is triggered. Since this is a "scale out" setting, it should typically
  be a positive value. For more information see the
  [PercentChangeInCapacity documentation](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-simple-step.html#as-scaling-adjustment),
  specifically the section on `PercentChangeInCapacity`.

```yaml
# Defaults
ecs:
  clusterAutoscaling:
    scaleInThresholdPercent: 25
    scaleInAdjustmentPercent: -5
    scaleOutThresholdPercent: 75
    scaleOutAdjustmentPercent: 10
```

The default behavior is that, if more than 75% of your cluster's CPU or memory
has been reserved, the size of the cluster will be increased by 10%. (There is a
minimum change of 1 instance.) If _both_ CPU and memory reservation for the
cluster are under 25%, then the cluster size will be reduced by 5%.

#### Service AutoScaling

Cumulus supports automatically scaling the number of tasks configured for an ECS
service. The scaling of tasks is based on the `ActivityScheduleTime` metric,
which measures how long (in milliseconds) an activity waited before being picked
up for processing. If the average activity is waiting more than the configured
`scaleOutActivityScheduleTime` time, then additional tasks will be added to the
service. If the average activity is waiting less than the configured
`scaleInActivityScheduleTime` time, then tasks will be removed from the service.
Ideally, the average wait time for tasks should settle somewhere between
`scaleInActivityScheduleTime` and `scaleOutActivityScheduleTime`.

Configuration values that affect ECS service autoscaling. These would all be
defined for a specific service.

* `minTasks`: the minimum number of tasks to maintain in a service
* `maxTasks`: the maximum number of tasks to maintain in a service
* `scaleInAdjustmentPercent`: the percentage to increase or decrease the number
  of tasks in the cluster by when the "scale in" alarm is triggered. Since this
  is a "scale in" setting, it should typically be a negative value. For more
  information see the
  [PercentChangeInCapacity documentation](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-simple-step.html#as-scaling-adjustment),
  specifically the section on `PercentChangeInCapacity`.
* `scaleInActivityScheduleTime`: a duration in milliseconds. If the average task
  is waiting for less than this amount of time before being started, then the
  number of tasks configured for the service will be reduced
* `scaleOutAdjustmentPercent`: the percentage to increase or decrease the number
  of tasks in the cluster by when the "scale out" alarm is triggered. Since this
  is a "scale out" setting, it should typically be a negative value. For more
  information see the
  [PercentChangeInCapacity documentation](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-simple-step.html#as-scaling-adjustment),
  specifically the section on `PercentChangeInCapacity`.
  * `scaleOutActivityScheduleTime`: a duration in milliseconds. If the average
    task is waiting for more than this amount of time before being started, then
    the number of tasks configured for the service will be increased

**Notes**

* `minTasks` and `maxTasks` are required for autoscaling to be enabled
* `scaleInActivityScheduleTime` and `scaleInAdjustmentPercent` are required for
  scaling in to be enabled
* `scaleOutActivityScheduleTime` and `scaleOutAdjustmentPercent` are required
  for scaling out to be enabled
* When scaling of a service is triggered, the number of tasks will always change
  by at least 1, even if the number that would be changed based on the
  configured adjustment percent is less than 1.

**Example**

Only auto scaling-related fields are shown in this example config.

```yaml
ecs:
  services:
    ExampleService:
      minTasks: 1
      maxTasks: 10
      scaleInActivityScheduleTime: 5000
      scaleInAdjustmentPercent: -5
      scaleOutActivityScheduleTime: 10000
      scaleOutAdjustmentPercent: 10
```

In this example configuration, the minimum number of tasks is 1 and the maximum
is 10. If the average time for activities to be started is less than 5 seconds,
then the number of tasks configured for the service will be reduced by 5%. If
the average time for activities to be started is greater than 10 seconds, then
the number of tasks configured for the service will be increased by 10%.
Eventually, the average time that a task takes to start should hover between 5
and 10 seconds.

### es
Configuration for the Amazon Elasticsearch Service (ES) instance. Optional. Set `es: null` to disable ElasticSearch.

You can update `es` properties and add additional ES alarms. For example:

```yaml
  es:
    instanceCount: 2
    alarms:
      NodesHigh:
        alarm_description: 'There are more instances running than the desired'
        comparison_operator: GreaterThanThreshold
        threshold: '{{es.instanceCount}}'
        metric: Nodes
```

### sns

Cumulus supports configuration and deployment of SNS topics and subscribers using `app/config.yml`. In the following code snippets we'll see an example topic and subscriber configuration.

```yaml
sns:
  # this topic receives all the updates from
  # step functions
  sftracker:
    subscriptions:
      lambda:
        endpoint:
          function: Fn::GetAtt
          array:
            - sns2elasticsearchLambdaFunction
            - Arn
        protocol: lambda
```

The above code is an example of configuration for an SNS topic that will be called `sftrackerSns` in the resulting `cloudformation.yml` file. Upon deployment, this configuration creates an SNS topic named `<prefix>-sftracker` and subscribes the resource named `sns2elasticsearchLambdaFunction` to that topic so that it will be triggered when any messages are added to that topic.

More information for each of the individual attributes can be found in [AWS SNS Topic Documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-sns-topic.html).

```yaml
# sns: ...
  sftrackerSubscription:
    arn:
      Fn::GetAtt:
        - sftrackerSns
        - Arn
      endpoint:
        function: Fn::GetAtt
          array:
            - someOtherLambdaFunction
            - Arn
        protocol: lambda
```

This snippet is an example of configuration for a list of SNS Subscriptions. We are adding an existing lambda function (`someOtherLambdaFunction`) as a subscriber to an existing SNS Topic (`sfTrackerSns`). That is, this configuration assumes that the `sftrackerSns` Topic is configured elsewhere (as shown above) and that the definition of a lambda function, `someOtherLambdaFunction`, is in your configuration.

The main difference between this and the previous example is the inclusion of the `sns.arn` attribute - this tells our deployment/compiling step that we're configuring subscriptions, not a new topic. More information for each of the individual attributes can be found in [AWS SNS Subscription Documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-sns-subscription.html).

### iams

Optional. Overrides allowed if your IAM role ARNs do not match the following convention used in `@cumulus/deployment/app/config.yml`:

```yaml
  iams:
    ecsRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/{{prefix}}-ecs'
    lambdaApiGatewayRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/{{prefix}}-lambda-api-gateway'
    lambdaProcessingRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/{{prefix}}-lambda-processing'
    stepRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/{{prefix}}-steprole'
    instanceProfile: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:instance-profile/{{prefix}}-ecs'
    distributionRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/{{prefix}}-distribution-api-lambda'
    scalingRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/{{prefix}}-scaling-role'
    migrationRoleArn: 'arn:aws:iam::{{AWS_ACCOUNT_ID}}:role/{{prefix}}-migration-processing'
```

To override, add the ARNs for each of the seven roles and one instanceProfile created in the [Create IAM Roles](create-iam-roles) step. You can retrieve the ARNs from:

    $ aws iam list-roles | grep Arn
    $ aws iam list-instance-profiles | grep Arn

For information on how to locate them in the Console see [Locating Cumulus IAM Roles](iam_roles.md).

## apiConfigs

Use the apiConfigs to configure [private endpoints in API Gateway](https://aws.amazon.com/blogs/compute/introducing-amazon-api-gateway-private-endpoints/). The key for `apiConfigs` should be `backend` or `distribution`. To deploy a private API Gateway, set `private: true`. The `port` option can be set if you would like to configure tunneling via a certain port.

Example:
```
apiConfigs:
  backend:
    private: true
    port: 8000
  distribution:
    private: true
    port: 7000
```

**Note:** If you deploy a private API Gateway and you want to go back to public (Edge), that will not work via the deployment since AWS does not allow you to convert a private API Gateway to public. The easiest way is to follow the steps in [this document](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-api-migration.html) to switch your endpoint configuration to `Regional`, then to `Edge` using either the AWS Console or the CLI. Then you can redeploy with the `private: true` option removed.

# Footnotes

[^1]: This value is used by kes only to identify the configuration set to use and should not appear in any AWS object
