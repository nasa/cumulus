# GIBS-in-the-Cloud Prototype - Ingest

## Installing and deploying

### Prerequisites

* node.js >= 4.3 (https://nodejs.org/en/). We recommend using nvm (https://github.com/creationix/nvm)
* AWS CLI (http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
* Ruby
* BASH
* Docker (only required for building new container images)

Install the correct node version:

```
nvm install 4.3
```

Ensure that the aws cli is configured and that the default output format is either JSON or None:

```
aws configure
```

### Deployment

Deploy a new stack into AWS
```
$ bin/deploy --create my-stack-name my-keyname
```
The stack will be called "gitc-my-stack-name" and have two s3 buckets, "gitc-my-stack-name-deploy" for deployment
artifacts and "gitc-my-stack-name" for working files. By default, the stacks are deployed into us-west-2 (Oregon)
to separate them from the other projects that share our AWS space. 'my-keyname' will have access to its EC2
instances.

Redeploy an existing stack into AWS, required any time you make a code change.
```
$ bin/deploy my-stack-name my-keyname
```

If you are running `npm watch`, you can deploy even faster with
```
$ bin/deploy --no-compile my-stack-name my-keyname
```

See `bin/deploy --help` for more information about deployment options

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

### Troubleshooting

If you receive errors of this form:

'''
ERROR in ./tasks/trigger-ingest/index.js
Module not found: Error: Cannot resolve module 'gitc-common/task' in /Users/pquinn/earthdata/gitc/gitc/ingest/tasks/trigger-ingest
@ ./tasks/trigger-ingest/index.js 15:11-38
'''

It is likely you are using a version of npm that is too recent. Try using nvm to manage your node version, use node version 4.3.* and npm 2.*.*
