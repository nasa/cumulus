---
id: additional-lambda-logging
title: Lambda Log Subscriptions
hide_title: true
---

# Lambda logging subscriptions


It is now possible to configure any lambda to deliver logs to a subscription location by setting the `logToSharedDestination` to `true` on the lambda config. This will configure CloudFormation to create the corrrect Log Group and Subscription Filter that will point to the defined `sharedLogDestinationArn`.   **Note** `logToSharedDestination` to `true` on a lambda configuration.

*Example config:*
```yml
HelloWorld:
    handler: index.handler
    source: node_modules/@cumulus/hello-world/dist/
    logToSharedDestination: true
```
