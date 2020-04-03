---
id: logging-for-metrics
title: Writing logs for Metrics
hide_title: true
---

# Writing logs for NGAP ESDIS Metrics

For messages logged by workflow task code that conform to an expected format, ESDIS metrics will automatically parse and ingest these messages to enable helpful searching/filtering of your logs via their Kibana dashboard.

**Note:** In order for ESDIS metrics to receive and process your logs, you must [configure your Cumulus deployment to deliver your workflow task logs to the correct shared logs destination for ESDIS metrics](../additional-deployment-options/cloudwatch-logs-delivery).

## Expected log format

In order for your logs to be parsable by ESDIS metrics, your code should log a JSON string representation of an object (`dict` in Python or `map` in Java) containing the following properties:

- `executions`: The AWS Step Function exection name in which this task is executing
- `granules`: A JSON string of the array of granule IDs being processed by this task
- `level`: A string identifier for the type of message being logged. Possible values:
  - `debug`
  - `error`
  - `fatal`
  - `info`
  - `warn`
  - `trace`
- `message`: String containing your actual log message
- `parentArn`: The parent AWS Step Function execution ARN that triggered the current execution, if any
- `sender`: The name of the resource executing this task (e.g. Lambda function name or ECS activity name)
- `stackName`: The unique prefix for your Cumulus deployment
- `timestamp`: An ISO-8601 formatted timestamp for the current time
- `version`: The version of the resource executing this task, if any
