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

Ensure your CMR username/password is included in your ```app/.env``` file, as noted in the [deployment documentation](./deployment-readme):

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
