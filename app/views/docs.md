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
    "performance": [
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
        "performance": [
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
{
  "services": [
    {
      "service_name": "GenerateMrf",
      "desired_count": 2,
      "events": [
        {
          "id": "3ec891c4-cb83-4c49-bb16-3d1ab0c5f8eb",
          "date": "2017-05-26T11:42:53.817Z",
          "message": "(service gitc-xx-IngestStack-123-GenerateMrfService) has reached a steady state."
        }
      ],
      "running_tasks": [
        {
          "started_at": "2017-05-26T11:42:47.173Z"
        },
        {
          "started_at": "2017-05-26T11:42:46.190Z"
        }
      ]
    },
    {
      "service_name": "SfnScheduler",
      "desired_count": 1,
      "events": [
        {
          "id": "739c811c-415f-4971-a9e9-fcec02d4329a",
          "date": "2017-05-19T18:23:00.538Z",
          "message": "(service gitc-xx-IngestStack-123-SfnSchedulerService) was unable to place a task because no container instance met all of its requirements. Reason: No Container Instances were found in your cluster. For more information, see the Troubleshooting section of the Amazon ECS Developer Guide."
        }
      ],
      "running_tasks": [
        {
          "started_at": "2017-05-26T11:42:39.777Z"
        }
      ]
    },
    {
      "service_name": "OnEarth",
      "desired_count": 3,
      "events": [
        {
          "id": "5aa0c9f4-7dd0-4951-a3b9-f486afcd611f",
          "date": "2017-05-23T03:19:54.716Z",
          "message": "(service gibs-oe-xx-OnEarthStack-123-OnearthDocker) has reached a steady state."
        },
        {
          "id": "61f80e6d-b261-4e18-afb1-d2dd986106d1",
          "date": "2017-05-17T15:07:09.191Z",
          "message": "(service gibs-oe-xx-OnEarthStack-123-OnearthDocker) has started 3 tasks: (task 81524543-74d1-4d95-b455-7cff89088515) (task 9d78d227-9882-4302-8f9f-4deab64484c6) (task 07520087-779a-490d-bd69-34f1e4c12a66)."
        }
      ],
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
  ],
  "connections": {
    "MODAPS": {
      "connection_limit": 50,
      "used": 40
    },
    "LARC": {
      "connection_limit": 50,
      "used": 0
    }
  }
}

```

## /product_status

Returns status information on a product (aka collection) within a particular workflow.

Params:

* `stack_name` - The name of main top level stack that contains ingest and other substacks.
* `workflow_id` - The id of the workflow
* `collection_id` - The id of the collection
* `num_executions` - The maximum number of executions to return.

```Bash
curl 'http://localhost:3000/product_status?stack_name=gitc-xx&workflow_id=IngestVIIRS&collection_id=VNGCR_LQD_C1&num_executions=5'
```

The response contains a list of the executions currently running for the workflow for the collection along with a set of completed executions and the performance latencies on days over the past week.

```JSON
{
  "running_executions": [
    {
      "start_date": "2017-06-01T17:27:58.246Z",
      "granule_id": "2017152",
      "current_state": "MRFGen"
    },
    ...
  ],
  "completed_executions": [
    {
      "start_date": "2017-06-01T17:12:59.000Z",
      "stop_date": "2017-06-01T17:18:56.000Z",
      "elapsed_ms": 357000,
      "success": true,
      "granule_id": "2017152"
    },
    ...
  ],
  "performance": [
    {
      "50": 2000,
      "95": 252300.00000000064,
      "date": 1495670400000
    },
    ...
  ]
}
```