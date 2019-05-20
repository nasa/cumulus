---
id: version-v1.13.0-troubleshoot_deployment
title: Troubleshooting Cumulus Deployment
hide_title: true
original_id: troubleshoot_deployment
---

# Troubleshooting Cumulus Deployment

This document provides 'notes' on frequently encountered deployment issues. The issues reported are organized by relevant subsection.

## Configuring the Cumulus Stack

### VPC

Issues:

- If redeploying an existing configuration you may already have at least 1 vpc associated with your existing deployment, but its subnets can be transitory in nature depending on what kind of load balancing and/or docker activities are taking place at a given time.  You should  identify at least one persistent subnet to use as a subnet ID (you may only specify one) for use.    If this is needed, navigate to  [AWS EC2 > Auto Scaling Groups](https://console.aws.amazon.com/ec2/autoscaling/home?region=us-east-1#AutoScalingGroups:view=details) and note the "Availability Zone" (e.g., us-east-1a). Next, visit [AWS VPC](https://console.aws.amazon.com/vpc/home) and click on "Subnets". Copy the 'VPC' value into 'vpcId' and the appropriate 'Subnet ID' value, based on the Availability Zone value you just saw on the Auto Scaling Groups page, into 'subnets'. If you have no vpc and/or subnets, do not include the vpc section in your new configuration.

Example config:

```yaml
vpc:
  vpcId: vpc-1234abcd
  subnets:
    - subnet-1234ancd

ecs:
  instanceType: t2.micro
  desiredInstances: 1
  availabilityZone: us-east-1a
```

## Deploying the Cumulus Stack

Monitoring the progress of stack deployment can be done from the [AWS CloudFormation Console](https://console.aws.amazon.com/cloudformation/home).

Issues:

### **Error:** __"The availability zones of the specified subnets and the Auto Scaling group do not match"

See [vpc issues](#vpc)

### Error: Stack.. is in ROLLBACK_COMPLETE (or ROLLBACK_FAILED) state and can not be updated.

The stack cannot be re-deployed if it is currently in ROLLBACK_COMPLETE or ROLLBACK_FAILED.

If this is a new deployment, delete the stack and try deploying again.

You may be able to continue the rollback operation. At the top of the CloudFormation page for the stack, click the 'Other Actions' dropdown and choose to continue rollback.

In the advanced settings when continuing rollback, you can enter the logical Ids of resources to skip that are preventing rollback. These ids can be found in the resources section of the CloudFormation page for the stack.

### Failure on nested stacks

If the deployment failed on nested stacks (CumulusApiDefaultNestedStack, CumulusApiV1NestedStack), and the nested stacks are gone due to rollback.  Try to deploy the just the main stack first by adding a nested_template parameter set to null in your stack config app/config.yml file, and then run the deployment.

```yaml
<your deployment>:
  nested_template: null
  prefix: <replace-with-stack-prefix>
```

When the main stack is in 'CREATE_COMPLETE' state from the AWS console (ignore the kes error { BadRequestException: The REST API doesn't contain any methods}), remove the 'nested_template' line and redeploy again.  Then the nested stacks will stay, and you can debug the errors.

### Missing helper: ifEquals (or similar error)

This error indicates that a helper used by [`kes`](https://github.com/developmentseed/kes) to interpret Cloudformation templates is not present, so Cloudformation template compilation is failing and deployment cannot continue.

First, verify that the `--template` argument to your deployment command points to a directory containing a `kes.js` file. By default, the value of `--template` for a Cumulus deployment should be `node_modules/@cumulus/deployment/app`. If you are using a different directory as your deployment template, then you are responsible for maintaining a `kes.js` file in that folder with the latest changes from [`@cumulus/deployment`](https://github.com/nasa/cumulus/blob/master/packages/deployment/lib/kes.js).

If you are still experiencing the error, try updating `kes` to use the [latest released version](https://github.com/developmentseed/kes/releases).

## Install dashboard

### Dashboard configuration

Issues:

- __Problem clearing the cache: EACCES: permission denied, rmdir '/tmp/gulp-cache/default'__", this probably means the files at that location, and/or the folder, are owned by someone else (or some other factor prevents you from writing there).

It's possible to workaround this by editing the file `cumulus-dashboard/node_modules/gulp-cache/index.js` and alter the value of the line `var fileCache = new Cache({cacheDirName: 'gulp-cache'});` to something like `var fileCache = new Cache({cacheDirName: '<prefix>-cache'});`. Now gulp-cache will be able to write to `/tmp/<prefix>-cache/default`, and the error should resolve.

### Dashboard deployment

Issues:

- If the dashboard sends you to an Earthdata Login page that has an error reading __"Invalid request, please verify the client status or redirect_uri before resubmitting"__, this means you've either forgotten to update one or more of your EARTHDATA_CLIENT_ID, EARTHDATA_CLIENT_PASSWORD environment variables (from your app/.env file) and re-deploy Cumulus, or you haven't placed the correct values in them, or you've forgotten to add both the "redirect" and "token" URL to the Earthdata Application.
- There is odd caching behavior associated with the dashboard and Earthdata Login at this point in time that can cause the above error to reappear on the Earthdata Login page loaded by the dashboard even after fixing the cause of the error. If you experience this, attempt to access the dashboard in a new browser window, and it should work.
