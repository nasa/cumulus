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

### Cluster AutoScaling

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

### Service AutoScaling

Cumulus supports automatically scaling the number of tasks configured for an ECS
service. The scaling of tasks is based on the `ActivityScheduleTime` metric,
which measures how long (in milliseconds) an activity waited before being picked
up for processing. If the average activity is waiting more than the configured
`scaleOutActivityScheduleTime` time, then additional tasks will be added to the
service. If the average activity is waiting less than the configured
`scaleInActivityScheduleTime` time, then tasks will be removed from the service.
Ideally, the average wait time for tasks should settle somewhere between those
two numbers.

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

## es
Configuration for the Amazon Elasticsearch Service (ES) instance.  You can update `es` properties and add additional ES alarms. For example:

    es:
      instanceCount: 2
      alarms:
        NodesHigh:
          alarm_description: 'There are more instances running than the desired'
          comparison_operator: GreaterThanThreshold
          threshold: '{{es.instanceCount}}'
          metric: Nodes

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
