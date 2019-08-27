---
id: version-v1.14.0-additional-lambda-logging
title: Lambda Log Subscriptions
hide_title: true
original_id: additional-lambda-logging
---

# Lambda logging subscriptions


It is now possible to configure any lambda to deliver logs to a shared subscription by updating the lambda's config with a `logToSharedDestination` key whose value is a writable location (either an AWS::Logs::Destination or a Kinesis Stream). This will configure CloudFormation to create the LogGroup and SubscriptionFilter pointing to the `logToSharedDestination` value.

*Example config:*
```yml
HelloWorld:
    handler: index.handler
    source: node_modules/@cumulus/hello-world/dist/
    logToSharedDestination: arn:aws:logs:us-east-1:123456789012:destination:CumulusLogDestination
```
