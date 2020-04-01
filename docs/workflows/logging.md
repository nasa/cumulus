---
id: lambda
title: Writing logs for Metrics
hide_title: true
---

# Writing logs for Metrics

For messages logged in a certain format from workflow task code, ESDIS metrics will automatically parse these messages and enable helpful searching/filtering via their Kibana dashboard.

## Expected format

To be parsable by ESDIS metrics, your code should log an object (`dict` in Python or `map` in Java) containing the following properties:

- executions: The AWS Step Function exection name in which this task is executing
- granules: A JSON string of the array of granule IDs being processed by this task
- parentArn: The parent AWS Step Function execution ARN that triggered the current execution, if any
- sender: The name of the resource executing this task (e.g. Lambda function name or ECS activity name)
- stackName: The unique prefix for your Cumulus deployment
- version: The version of the resource executing this task, if any
