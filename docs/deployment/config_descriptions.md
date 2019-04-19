---
id: config_descriptions
title: Configuration Descriptions
hide_title: true
---

# IAM Configuration

## iam-deployment-name

The name (e.g. dev) of the the 'deployment' - this key tells kes which configuration set (in addition to the default values) to use when creating the cloud formation template[^1]

## prefix

This value will prefix CloudFormation-created IAM resources and permissions. **The `stackName` used in the [app](deployment/deployment-readme#configure-and-deploy-the-cumulus-stack) deployment must start with this prefix or the deployment will not work correctly.**

## stackName

The name of this iam stack in CloudFormation (e.g. <prefix>-iam).

**The cumulus stack name must start with `<prefix>`** [^2]

## buckets

The buckets created in the [Create S3 Buckets](#create-s3-buckets) step. Buckets are defined in the config.yml with a key, name, and type. Types should be one of: internal, public, private, or protected. Multiple buckets of each type can be configured. A key is used for the buckets to allow for swapping out the bucket names easily.

## useNgapPermissionBoundary

If deploying to a NASA NGAP account, set `useNgapPermissionBoundary: true`.

# App Configuration

## cumulus-deployment-name

The name (e.g. dev) of the the 'deployment' - this key tells kes which configuration set (in addition to the default values) to use when creating the cloud formation template[^1]

## stackName

The name of this stack in CloudFormation. **This value must start with the `prefix` used in the [IAM](deployment/deployment-readme#configure-and-deploy-the-iam-stack) deployment or the deployment will not work correctly.**

## stackNameNoDash

A representation of the stack name that has dashes removed. This will be used for components that should be associated with the stack but do not allow dashes in the identifier.

## vpc

Configure your virtual private cloud.  You can find `<vpc-id>` and `<subnet-id>` values on the [VPC Dashboard](https://console.aws.amazon.com/vpc/home?region=us-east-1#). `vpcId` from [Your VPCs](https://console.aws.amazon.com/vpc/home?region=us-east-1#vpcs:), and `subnets` [here](https://console.aws.amazon.com/vpc/home?region=us-east-1#subnets:). When you choose a subnet, be sure to also note its availability zone, to configure `ecs`.

## cmr

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
  provider: CUMULUS
  clientId: '<replace-with-daac-name>-{{stackName}}'
  password: '{{CMR_PASSWORD}}'
```

`clientId` and `provider` should be configured to point to a user specified CMR `clientId` and `provider`. We use the `CUMULUS` provider in our configurations, but users can specify their own.

## ecs

Configuration for the Amazon EC2 Container Service (ECS) instance.  Update `availabilityZone` (or `availabilityZones` if using multiple AZs) with information from [VPC Dashboard](https://console.aws.amazon.com/vpc/home?region=us-east-1#)
note `instanceType` and `desiredInstances` have been selected for a sample install.  You will have to specify appropriate values to deploy and use ECS machines.   See [EC2 Instance Types](http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-types.html) for more information.

Also note, if you dont specify the `amiid`, it will try to use a default, which may or may not exist.

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

### AutoScaling

Cumulus ECS clusters have the ability to scale out and in based on
[CPU and memory reservations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cloudwatch-metrics.html#cluster_reservation).
There are a few configuration values that affect how the ECS cluster instances
scale:

* `ecs.autoscaling.scaleInThresholdPercent`: the reservation percentage where,
  if both CPU and memory are under, the EC2 cluster will be scaled in
* `ecs.autoscaling.scaleOutThresholdPercent`: the reservation percentage where,
  if both CPU and memory are under, the EC2 cluster will be scaled out
* `ecs.autoscaling.scalingAdjustmentPercent`: the percentage to increase or
  decrease the cluster size by when a scaling action is taken. For more
  information see the
  [PercentChangeInCapacity documentation](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-simple-step.html#as-scaling-adjustment),
  specifically the section on `PercentChangeInCapacity`.

```yaml
# Defaults
ecs:
  autoscaling:
    scaleInThresholdPercent: 25
    scaleOutThresholdPercent: 75
    scalingAdjustmentPercent: 10
```

The default behavior is that, if more than 75% of your cluster's CPU or memory
has been reserved, the size of the cluster will be increased by 10%. (There is a
minimum change of 1 instance.) If _both_ CPU and memory reservation for the
cluster are under 25%, then the cluster size will be reduced by 10%.

## es
Configuration for the Amazon Elasticsearch Service (ES) instance.  You can update `es` properties and add additional ES alarms. For example:

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

## sns
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

The above code is an example of configuration for an SNS topic that will be called `sftrackerSns` in the resulting `cloudformation.yml` file. More information for each of the individual attributes can be found in [AWS SNS Topic Documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-sns-topic.html).

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

This snippet is an example of configuration for a list of SNS Subscriptions. The main difference between this and the previous example is the inclusion of the `sns.arn` attribute - this tells our deployment/compiling step that we're configuring subscriptions, not a new topic. More information for each of the individual attributes can be found in [AWS SNS Subscription Documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-sns-subscription.html).

## buckets

The config buckets should map to the same names you used when creating buckets in the [Prepare AWS](#prepare-aws-configuration) step. Buckets are defined in the config.yml with a key, name, and type. Types should be one of: internal, public, private, or protected. Multiple buckets of each type can be configured.

## iams

Add the ARNs for each of the seven roles and one instanceProfile created in the [Create IAM Roles](create-iam-roles) step. You can retrieve the ARNs from:

    $ aws iam list-roles | grep Arn
    $ aws iam list-instance-profiles | grep Arn

For information on how to locate them in the Console see [Locating Cumulus IAM Roles](iam_roles.md).

## users

List of EarthData users you wish to have access to your dashboard application. These users will be populated in your `<stackname>-UsersTable` [DynamoDb](https://console.aws.amazon.com/dynamodb/) table.

# Footnotes

[^1]: This value is used by kes only to identify the configuration set to use and should not appear in any AWS object
[^2]: For more on the AWS objects this impacts, you can look through iam/cloudformation.template.yml
