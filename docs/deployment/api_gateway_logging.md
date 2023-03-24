---
id: api-gateway-logging
title: API Gateway Logging
hide_title: false
---

## Enabling API Gateway Logging

In order to enable distribution API Access and execution logging, configure the TEA deployment by setting `log_api_gateway_to_cloudwatch` on the `thin_egress_app` module:

```hcl
log_api_gateway_to_cloudwatch = true
```

This enables the distribution API to send its logs to the default CloudWatch location: `API-Gateway-Execution-Logs_<RESTAPI_ID>/<STAGE>`

## Configure Permissions for API Gateway Logging to CloudWatch

### Instructions: Enabling Account Level Logging from API Gateway to CloudWatch

This is a one time operation that must be performed on each AWS account to allow API Gateway to push logs to CloudWatch.

1. ### Create a policy document

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

2. ### Create an account role to act as ApiGateway and write to CloudWatchLogs

:::info in NGAP

**NASA users in NGAP**: Be sure to use your account's permission boundary.

:::

```sh
    aws iam create-role \
    --role-name ApiGatewayToCloudWatchLogs \
    [--permissions-boundary <permissionBoundaryArn>] \
    --assume-role-policy-document file://apigateway-policy.json
    ```

    Note the ARN of the returned role for the last step.

3. ### Attach correct permissions to role

    Next attach the `AmazonAPIGatewayPushToCloudWatchLogs` policy to the IAM role.

    ```sh
    aws iam attach-role-policy \
    --role-name ApiGatewayToCloudWatchLogs \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
    ```

4. ### Update Account API Gateway settings with correct permissions

    Finally, set the IAM role ARN on the `cloudWatchRoleArn` property on your API Gateway Account settings.

    ```sh
    aws apigateway update-account \
    --patch-operations op='replace',path='/cloudwatchRoleArn',value='<ApiGatewayToCloudWatchLogs ARN>'
    ```

## Configure API Gateway CloudWatch Logs Delivery

For details about configuring the API Gateway CloudWatch Logs delivery, see [Configure Cloudwatch Logs Delivery](configure_cloudwatch_logs_delivery.md).
