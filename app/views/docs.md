# GIBS Ops API

Defines an API for operating GIBS.

## /health

Returns an application health response.

```Bash
curl http://localhost:3000/health
```
```JSON
{"ok?": true}
```

## /workflow_status

TODO update these docs here.

Returns a list of configured ingest workflows along with recent executions.

Params:

* `stack_name` - The name of the deployed AWS CloudFormation stack containing Step Function State Machines.
* `num_executions` - The number of executions to return with each workflow. Must be between 1 and 1000 inclusive.

```Bash
curl "http://localhost:3000/workflow_status?stack_name=gitc-xx-sfn&num_executions=2"
```
```JSON
[
  {
    "id": "DiscoverVIIRS",
    "name": "VIIRS Discovery",
    "executions": [
      {
        "status": "SUCCEEDED",
        "start_date": "2017-04-26T12:22:01.549Z",
        "stop_date": "2017-04-26T12:25:23.765Z"
      },
      {
        "status": "SUCCEEDED",
        "start_date": "2017-04-26T12:24:22.889Z",
        "stop_date": "2017-04-26T12:24:43.933Z"
      }
    ]
  },
  {
    "id": "IngestVIIRS",
    "name": "VIIRS Ingest",
    "executions": [
      {
        "status": "SUCCEEDED",
        "start_date": "2017-04-26T12:25:23.563Z",
        "stop_date": "2017-04-26T12:25:25.243Z"
      },
      {
        "status": "SUCCEEDED",
        "start_date": "2017-04-26T12:25:18.622Z",
        "stop_date": "2017-04-26T12:25:21.167Z"
      }
    ]
  }
]
```

## /service_status

TODO document this