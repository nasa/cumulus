---
id: version-v1.16.0-api-gateway-logging
title: API Gateway Logging
hide_title: true
original_id: api-gateway-logging
---

# API Gateway Logging

## Enabling API Gateway logging

In order to enable API Access and Execution logging, configure the Cumulus deployment by setting `log_api_gateway_to_cloudwatch` on the `cumulus` module:

```hcl
log_api_gateway_to_cloudwatch = true
```

This enables the distribution API to send its logs to the default CloudWatch location: `API-Gateway-Execution-Logs_<RESTAPI_ID>/<STAGE>`

## Configure Permissions for API Gateway Logging to CloudWatch

### Instructions for enabling account level logging from API Gateway to CloudWatch

This is a one time operation that must be performed on each AWS account to allow API Gateway to push logs to CloudWatch.

### Create a policy document

The `AmazonAPIGatewayPushToCloudWatchLogs` managed policy, with an ARN of `arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs`, has all the required permissions to enable API Gateway logging to CloudWatch.  To grant these permissions to your account, first create an IAM role with `apigateway.amazonaws.com` as its trusted entity.

Save this snippet as `apigateway-policy.json`.

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "",
            "Effect": "Allow",
            "Principal": {
                "Service": "apigateway.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
```

### Create an account role to act as ApiGateway and write to CloudWatchLogs

NASA users in NGAP: be sure to use your account's permission boundary.

```sh
aws iam create-role \
--role-name ApiGatewayToCloudWatchLogs \
[--permissions-boundary <permissionBoundaryArn>] \
--assume-role-policy-document file://apigateway-policy.json
```

Note the Arn of the returned role for the last step.

### Attach correct permissions to role

Next attach the `AmazonAPIGatewayPushToCloudWatchLogs` policy to the IAM role.

```sh
aws iam attach-role-policy \
--role-name ApiGatewayToCloudWatchLogs \
--policy-arn "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
```

### Update Account API Gateway settings with correct permissions

Finally, set the IAM role ARN on the `cloudWatchRoleArn` property on your API Gateway Account settings.

```sh
aws apigateway update-account \
--patch-operations op='replace',path='/cloudwatchRoleArn',value='<ApiGatewayToCloudWatchLogs ARN>'
```

## Configure API Gateway CloudWatch Logs Delivery

As an optional configuration step, it is possible to deliver CloudWatch API execution and access logs to a cross-account shared AWS::Logs::Destination. An operator does this by configuring the `cumulus` module for [your deployment](../deployment/README.md#configure-and-deploy-the-cumulus-tf-root-module) as shown below. The value of the `log_destination_arn` variable is the ARN of a writable log destination.

The value can be either an [AWS::Logs::Destination](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-destination.html) or a [Kinesis Stream](https://aws.amazon.com/kinesis/data-streams/) ARN to which your account can write.

```hcl
log_api_gateway_to_cloudwatch = true
log_destination_arn           = arn:aws:[kinesis|logs]:us-east-1:123456789012:[streamName|destination:logDestinationName]
```

For NASA/NGAP deployments an operator should make a request to the metrics team for write access and the correct shared Logs Destination for further processing in their [ELK](https://www.elastic.co/elk-stack) stack.
