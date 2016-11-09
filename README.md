# GIBS-in-the-Cloud Prototype - Ingest

## Installing and deploying

### Prerequisites

* node.js >= 4.2 (https://nodejs.org/en/)
* AWS SDK (http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
* BASH
* Docker (only required for building new container images)

### Deployment

Deploy a new stack into AWS
```
$ bin/deploy my-stack-name create my-keyname
```
The stack will be called "gitc-my-stack-name" and have two s3 buckets, "gitc-my-stack-name-deploy" for deployment
artifacts and "gitc-my-stack-name" for working files. By default, the stacks are deployed into us-west-2 (Oregon)
to separate them from the other projects that share our AWS space. 'my-keyname' will have access to its EC2
instances

Redeploy an existing stack into AWS, required any time you make a code change.
```
$ bin/deploy my-stack-name update my-keyname
```

If you are running `npm watch`, you can deploy even faster with
```
$ bin/deploy my-stack-name push my-keyname
```

### Useful commands

Install all dependencies (run after cloning the project and every time dependencies change)
```
$ npm install
```

Run test suite
```
$ npm test
```

To constantly rebuild during development:
```
$ npm watch
```

Finally, you may test all your ingest changes locally by running the following in the dist directory:

```
$ node discover-http-tiles local <some-bucket-name> | node sync-http-urls stdin | node generate-mrf stdin
```

The above command will discover all tiles from a small VIIRS subdirectory, pass those to the sync
function, syncing to a test path, then pass the output to mrf generation, which will download
all the files, output the configuration file, then likely bail due to the lack of local gdal support
for MRF.

### Logs

Logs from ingest go into several CloudWatch Logs groups

1. gitc-<stack>-transactions : Contains high-level significant event logs for transactions which involve MRF generation.
Currently these only contain errors and information on start/stop timing for synchronization and MRF generation.
2. gitc-<stack>-service-dispatcher-ecs : Event dispatch logs
3. gitc-<stack>-service-scheduler-ecs : Ingest scheduler logs
4. gitc-<stack>-task-generate-mrf-ecs : MRF generation logs
5. /aws/lambda/gitc-<stack>-task-sync-http-urls : Synchronization logs for HTTP tile fetches
6. /aws/lambda/gitc-<stack>-task-discovery-http-tiles : Logs for the discovery mechanisms that do web crawls
7. /aws/lambda/gitc-<stack>-yas3fs-notifier : Logs for the yas3fs cache invalidation function
