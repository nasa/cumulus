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

Returns a list of configured ingest workflows along with recent executions.

Params:

* `stack_name` - The name of the deployed AWS CloudFormation stack containing Step Function State Machines.

```Bash
curl "http://localhost:3000/workflow_status?stack_name=gitc-xx"
```
```JSON
[
  {
    "id": "DiscoverVIIRS",
    "name": "VIIRS Discovery",
    "success_ratio": {
      "successes": 322,
      "total": 448
    },
    "ingest_perf": [
      {
        "50": 22000,
        "95": 199650,
        "date": 1495152000000
      },
      ...
    ],
    "products": [
      {
        "id": "VNGCR_LQD_C1",
        "last_granule_id": "2017142",
        "last_execution": {
          "stop_date": 1495458287000,
          "success": true
        },
        "success_ratio": {
          "successes": 108,
          "total": 150
        },
        "ingest_perf": [
          {
            "50": 192000,
            "95": 202900,
            "date": 1495152000000
          },
          ...
        ],
        "num_running": 1
      },
      ...
    ]
  },
  ...
]
```

## /service_status

Returns a list of statuses of the services running for GIBS

Params:

* `main_stack_name` - The name of main top level stack that contains ingest and other substacks.
* `on_earth_stack_name` - The name of stack containing the on earth resources.

```Bash
curl 'http://localhost:3000/service_status?main_stack_name=gitc-xx&on_earth_stack_name=gibs-oe-xx'
```

The response contains the number of tasks that should be running for the service. Any running tasks are included in the service with the date at which they were started. A number of running tasks less than the desired count indicates that not enough tasks are running.

```JSON
[
  {
    "service_name": "GenerateMrf",
    "desired_count": 2,
    "running_tasks": [
      {
        "started_at": "2017-05-22T15:09:28.911Z"
      }
    ]
  },
  {
    "service_name": "SfnScheduler",
    "desired_count": 1,
    "running_tasks": [
      {
        "started_at": "2017-05-22T15:09:30.206Z"
      }
    ]
  },
  {
    "service_name": "OnEarth",
    "desired_count": 3,
    "running_tasks": [
      {
        "started_at": "2017-05-17T15:09:46.169Z"
      },
      {
        "started_at": "2017-05-17T15:09:52.604Z"
      },
      {
        "started_at": "2017-05-17T15:09:48.299Z"
      }
    ]
  }
]
```