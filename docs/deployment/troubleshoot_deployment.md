# Troubleshooting Cumulus Deployment

This document provides 'notes' on frequently encountered deployment issues.

The issues reported are organized by relevant subsection, and *may* be out of date given the current rate of development.   Use at your own risk.

## Deploy Cumulus
### Installation
Issues:

- If you have a `PEM_read_bio` error when bootstrapping, SSL certificates may be to blame

#### Configure Cumulus Stack
##### vpc

Issues:

  - If redeploying an existing configuration you may already have at least 1 vpc associated with your existing deployment, but its subnets can be transitory in nature depending on what kind of load balancing and/or docker activities are taking place at a given time.  You should  identify at least one persistent subnet to use as a subnet ID (you may only specify one) for use.    If this is needed, navigate to  [AWS EC2 > Auto Scaling Groups](https://console.aws.amazon.com/ec2/autoscaling/home) and note the "Availability Zone" (e.g., us-east-1a). Next, visit [AWS VPC](https://console.aws.amazon.com/vpc/home) and click on "Subnets". Copy the 'VPC' value into 'vpcId' and the appropriate 'Subnet ID' value, based on the Availability Zone value you just saw on the Auto Scaling Groups page, into 'subnets'. If you have no vpc and/or subnets, do not include the vpc section in your new configuration.

#### Deploy the Cumulus Stack

Monitoring the progress of stack deployment can be done from the [AWS CloudFormation Console](https://console.aws.amazon.com/cloudformation/home).

Issues:

-  **Error:** __"The availability zones of the specified subnets and the Auto Scaling group do not match"__ -- see [vpc issues](#vpc)

- **The deployment isn't failing but is taking a long time**, navigate to [AWS ECS](https://console.aws.amazon.com/ecs/home) and then to "Clusters". Identify the new cluster associated with your <prefix> app deployment and click on it. The summary table (shown at bottom) for the cluster probably says "Desired tasks 1", or some other non-zero number, and "Running tasks 0". Click Update, then update the cluster to change "Number of tasks" to 0, or else you will receive (eventually) an error such as __"Service arn:aws:ecs:us-east-1:numbers:service/<prefix>-cumulus-<ECS service name> did not stabilize"__ and your app deployment will fail.

- **If AWS stack rollback/deletion fails** , check for a failure to delete named State Machines that this stack created. The names of the specific state machines can be gathered from the "Events" section of the stack's output on the AWS CloudFormation Console; you can then (carefully) manually delete the specified State Machines, thus readying AWS for the next attempt.

### Install dashboard
#### Dashboard configuration
Issues:
-  __Problem clearing the cache: EACCES: permission denied, rmdir '/tmp/gulp-cache/default'__", this probably means the files at that location, and/or the folder, are owned by someone else (or some other factor prevents you from writing there).

  It's possible to workaround this by editing the file `cumulus-dashboard/node_modules/gulp-cache/index.js` and alter the value of the line `var fileCache = new Cache({cacheDirName: 'gulp-cache'});` to something like `var fileCache = new Cache({cacheDirName: '<prefix>-cache'});`. Now gulp-cache will be able to write to `/tmp/<prefix>-cache/default`, and the error should resolve.

#### Dashboard deployment
Issues:
- If the dashboard sends you to an Earthdata Login page that has an error reading __"Invalid request, please verify the client status or redirect_uri before resubmitting"__, this means you've either forgotten to update one or more of your EARTHDATA_CLIENT_ID, EARTHDATA_CLIENT_PASSWORD environment variables (from your app/.env file) and re-deploy Cumulus, or you haven't placed the correct values in theml, or you've forgotten to add both the "redirect" and "token" URL to the Earthdata Application.

- There is odd caching behavior associated with the dashboard and Earthdata Login at this point in time that can cause the above error to reappear on the Earthdata Login page loaded by the dashboard even after fixing the cause of the error. If you experience this, attempt to access the dashboard in a new browser window, and it should work.
