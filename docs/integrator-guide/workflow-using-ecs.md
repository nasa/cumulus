## Ingest Performance Tuning When Using ECS

## Performance Tuning and Throttling

There are several bottlenecks to the data ingest process. The optimal rate of ingest is a difficult balancing act, as ingesting too slowly means the ingest takes a large amount of calendar time, but ingesting too quickly risks overwhelming external systems that are accessed.

The two primary external limitations to throughput are copying assets from a DAAC to S3 and creating granules in CMR. In general, copying from a DAAC to S3 is slow with respect to typical data access speeds, and much more slow than intra-S3 transfers. This a challenge with imagery data files that are often very large, and further compounded when there is a large variability among data file sizes in a group (e.g., some are megabytes in size and take seconds to transfer, and others are gigabytes in size and take tens of minutes to transfer). Additionally, some DAAC servers have restrictions on how many simultaneous downloads are allowed per-IP.

Another limitation is when ingested granules are created in a system-specific CMR, which may be deployed using a low-scalability queue between the web service interface and the data store, restricting the maximum ingest rate.

Techniques to manage these limitations are discussed in the following sections.

### Sync Granule Performance

By default, the SyncGranule component is deployed as an AWS Lambda. Lambdas provide very flexible compute resources, such that one only pays for the amount of memory-hours they use. However, in the default configuration in Cumulus, they suffer from two major drawbacks:

1. Cumulus Lambdas are deployed within the private subnet of a VPC. This requires that their network traffic be routed through a NAT Gateway in a public subnet. All data retrieved by the Lambda from a DAAC web server will be charged at a rate of $0.045/GB. A typical bulk ingest can be petabytes of data, costing thousands of dollars, and even small test runs can cost hundreds of dollars. Lambdas deployed into public (instead of private) subnets cannot access the internet due to AWS networking constraints. Deploying them outside a VPC is a solution, though this is not currently supported by Cumulus.
2. Lambdas have an execution time limit of 15 minutes. Most of the execution time of SyncGranule is spent in I/O, downloading the from the source system (e.g., the DAAC). Some of these assets can be tens of gigabytes, and take longer than 15 minutes to download, causing the Lambda to timeout and fail. There is no Lambda-based workaround for this AWS time limit.

An alternative is to use ECS to execute SyncGranule instead of Lambda. Cumulus contains a [module](https://github.com/nasa/cumulus-ecs-task) that allows the conversion of a Lambda into an ECS Task. An example of using this module can be found in the [MAAP Cumulus deploy configuration](https://github.com/MAAP-Project/maap-cumulus-deploy/blob/master/cumulus-tf/sync_granule_activity.tf). In contrast with the constraint that Lambdas must be in a private subnet, the EC2 instances that the Sync Granule ECS Task is executed on can be placed in a public subnet. This means that no NAT Gateway transfer costs are incurred and there is no limit on execution time for a single granule.

A significant but manageable downside to using ECS instead of Lambda is that ECS resources must be explicitly provisioned and de-provisioned. It is recommended this be done prior to a large ingest by increasing the `ecs_cluster_desired_size` value and redeploying cumulus, and then decreasing it to 0 and redeploying when the ingest is complete. Each node costs about $1/day, so the cost savings are not significant. The current configuration does not automatically manage the provisioning of new EC2 instances in the inevitable case where instances are terminated, so this must be explicitly monitored and the stack redeployed to provision new ones to ensure the number of nodes defined in `ecs_cluster_desired_size` are actually running.

One limiting factor is the per-IP rate limiting in the DAAC. For the NSIDC DAAC, this is 15 simultaneous connections from a single IP. When using Lambdas, the IP of the Lambda is opaque, as the Lambdas could be executing across many different IPs or a single one. This requires artificially limiting the total concurrency to ensure that only 15 SyncGranule executions are ever executing, since they may all appear to have the same IP address. However, with ECS execution, we only need to ensure that only 15 executions are occurring on each EC2 instance (all of which have unique IPs), not total. We do this by configuring the SyncGranule task resource requirements in a way such that only fewer than 15 can be allocated to a single EC2 node. The number of ECS Task Executions that occur on an EC2 instance is determined by the CPU and memory requirements defined for the task. In the context of ECS, each EC2 instance has a defined quantity of CPU and memory resources. One vCPU has 1024 "CPU units" and memory is per MB. For example, a t3.medium has 2048 cpu units and 4096 memory units. Each ECS Task is defined with an
amount of cpu and memory that it requires, and executions of this task are allocated to EC2 instances with available resources. 

In the `sync_granule_service` module, we have the settings:

- cpu = 150
- memory_reservation = 300

When this task execution is allocated to an EC2 instance, it "takes" this amount of cpu and memory from the available resources. Task executions are allocated until all of the cpu or memory has been allocated.  

Typically, these settings are empirically determined by the actual resource needs of the component. However, we will be using them to make sure that 15 or fewer SyncGranule task executions get allocated to each EC2 node, so that we don't hit the 15 request-per-IP limit of the DAAC.
With these settings, 13 task execution instances would be allocated to each t3.medium, which is comfortably under our limit of 15 connections per IP. The task itself spends most of its time in I/O streaming data from one HTTP connection to another, so the actual compute and memory needs are very low. 

The next configuration is how many of these 13-task-executing nodes to allocate. 

The Cumulus module contains the configuration for the `ecs_cluster_desired_size`, which will allocate EC2
instances during cumulus deployment. The `ecs_cluster_max_size` must also be set to a value greater than or equal to the ecs_cluster_desired_size. For example, if ecs_cluster_desired_size is set to 5, there can be a maximum of 65 SyncGranule tasks executing concurrently. There are a few other ECS Tasks using this same compute pool, so ECS may only be able to run fewer.

The next limitation is how many SyncGranule task executions are allowed. This is configured in the 
`sync_granule_service` module by the parameter `desired_count`. This must less than 
the maximum number of SyncGranule tasks which can be provisioned per their resource constraints, e.g., 65 in the example above, so that there are enough resources left to provision the other two tasks (DiscoverGranules and QueueGranules) and should be no more than the throttled `execution_limit`, as there's no reason to run more tasks than could possibly be used by a single run of the periodic trigger that runs every minute to create new invocations up to the maximum concurrent executions. 

A Step Function execution is created by a Lambda that is triggered by an Event generated by the
`background_job_queue_watcher`. This runs once per minute (the most frequent allowed by AWS).
The `messageLimit` parameter determines how many messages will be queued for creation into step function
executions, so this must be larger than the per-minute rate of ingest, or starvation will occur. The precise value must be determined empirically, since 

Additionally, the `background_job_queue` SQS queue must be configured with a visibility timeout
(`visibility_timeout_seconds`) that is
larger than the maximum amount of time that any granule should take to process. Otherwise, a granule that
is already being processed by a task will have its SQS message become visible again, and another 
task will begin to process it (there may be some locking that may prevent this from happening, but it is 
at least unnecessary reprocessing of messages). By default, this is set to 30 minutes to allow for large, slow downloads to complete.

### Throttling for CMR

Ideally, CMR should be deployed using an ingest queue that allows a high rate of granule creation, such as SQS, instead of an in-memory queue. If SQS is used, CMR can have a very high ingest request rate, as the new granule creation actions are simply queued up by the API for eventual processing. However, with an in-memory queue, care must be taken to avoid filling the queue such that all memory is used and the system locks up.
If an in-memory queue is used and can't easily be changed to SQS, to ensure CMR is not broken by ingesting too quickly, these two parameters should be set appropriately (it is not clear if both if these actually have an effect, so this should be experimentally verified, but for now, we just set both of them). 

1. In `cumulus-tf/main.tf`, set `cumulus.throttled_queues[0].execution_limit` to the maximum per minute rate, e.g., 25.
2. In `cumulus-tf/additions.tf`, set `background_job_queue_watcher.input` attribute 
  `messageLimit` to the same value as `cumulus.throttled_queues[0].execution_limit`.

For example, the MAAP Project CMR configuration previously used an in-memory queue. When the queue was full, 500 status code responses started to be returned. With the memory available on that instance, if more than ~500 granules "backed up" on this queue, the CMR ingest would hang and require a restart. The configuration could handle 25-50 granules/min at a steady pace, but a "burst" of 750 messages in 3 minutes could cause it to hang.

### Discover Granules and Queue Granules Performance

Both the Discover Granules and Queue Granules ECS Tasks require enough memory to load and process all of the granules. If there is not enough available memory in the EC2 instance to which they are assigned, they may fail. In the initial stack deployment, this may appear as a repeated message like:

```
null_resource.restart_discover_granules_ecs_task[0]: Still creating... [13h35m41s elapsed]
null_resource.restart_queue_granules_ecs_task[0]: Still creating... [13h35m41s elapsed]
```

The fix for this is to increase the memory settings for each of these tasks. These are the `memory_reservation` setting in the `discover_granules_service` module in `cumulus-tf/addtions.tf` and the `queue_granules_service` in `cumulus-tf/lambda_queue_granules.tf`.

When making a change to an existing stack (usually to the task count), either of these task may simply fail to start with no error. It is important to check that they are both running after every change update.

This happens when the SyncGranule tasks are allocated in a way to don't leave enough memory resources on a single node to run the DiscoverGranules or QueueGranules task. This can be fixed either by (1) in the AWS Console, update the SyncGranule Service definition to have a value of `1` for `Number of tasks` or (2) change `sync_granule_service.desired_count` to 1 and deploy. This creates a configuration with enough available resources to run DiscoverGranules and QueueGranules. Then, set `sync_granule_service.desired_count` back to its production value (e.g., 48), and re-deploy. Deploying will increase the number of tasks for SyncGranule back to its desired value, but these won't block DiscoverGranules and QueueGranules since they'll already be running.

## Ingest Monitoring

Monitoring the rate of granule ingest can be done by looking at the SQS queue `backgroundJobQueue` metric "Number Of Messages Deleted", since these correspond 1:1 to granules ingested. Monitoring the progress of a large ingest can be done by looking at the "Approximate Number Of Messages Visible" metric.

The Ingest Step Function can be monitored for success and failures by finding the CloudWatch metrics for the "States" (as step functions are called in CloudWatch) for
the IngestAndPublishGranuleWorkflow. The ExecutionsSucceeded and ExecutionsFailed metrics record what the results of executing the step function is.