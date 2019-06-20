# Enable API Gateway Logging to CloudWatch

Instructions for enabling account level logging from API Gateway to CloudWatch.

## Create a policy document
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

## Create an account role to act as ApiGateway and write to CloudWatchLogs

```sh
aws iam create-role \
--role-name ApiGatewayToCloudWatchLogs \
[--permissions-boundary <permissionBoundaryArn>] \
--assume-role-policy-document file://apigateway-policy.json
```

Note the Arn of the created role for the last step.

## Attatch correct permissions to role.

```sh
aws iam attach-role-policy \
--role-name ApiGatewayToCloudWatchLogs \
--policy-arn "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
```

## Update Account Api Gateway settings with correct permissions.

```sh
aws apigateway update-account \
--patch-operations op='replace',path='/cloudwatchRoleArn',value='<ApiGatewayToCloudWatchLogs ARN>'
```
