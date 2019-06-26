---
id: configure-cloudwatch-logs-delivery
title: Configure CloudWatch Logs Delivery
hide_title: true
---

# Configure CloudWatch Logs Delivery


It is possible to deliver CloudWatch logs to a cross-account shared Logs::Destination.   An operator does this by adding two keys to the `config.yml` default level.

```yaml
default:
  logToSharedDestination: true
  sharedLogDestinationArn: '{{SHARED_LOG_DESTINATION_ARN}}'
```
The `SHARED_LOG_DESTINATION_ARN` should be set in your environment to be either an  [AWS::Logs::Destination](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-logs-destination.html) or a [Kinesis Stream](https://aws.amazon.com/kinesis/data-streams/) Arn to which your account can write.

For NASA/NGAP deployments an operator should request permission for and the location of the Metrics shared Logs destination for further processing in their [ELK](https://www.elastic.co/elk-stack) stack.
