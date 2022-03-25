---
id: version-v10.0.0-update-cma-2.0.2
title: Upgrade to CMA 2.0.2
hide_title: false
original_id: update-cma-2.0.2
---

## Updating a Cumulus Deployment to CMA 2.0.2

### Background

The Cumulus Message Adapter has been updated in [release 2.0.2](https://github.com/nasa/cumulus-message-adapter/releases/tag/v2.0.2) to no longer utilize the AWS step function API to look up the defined name of a step function task for population in meta.workflow_tasks, but instead use an incrementing integer field.

Additionally a bugfix was released in the form of v2.0.1/v2.0.2 following the initial 2.0.0 release, so all users should update to [release 2.0.2](https://github.com/nasa/cumulus-message-adapter/releases/tag/v2.0.2)

*The update is not tied to a particular version of Core*, however the update should be done across all task components in order to ensure consistent execution records.

### Changes

#### Execution Record Update

This update functionally means that Cumulus tasks/activities using the CMA will now record a record that looks like the following in `meta.workflowtasks`, and more importantly in the `tasks` column for an `execution` record:

#### Original

```json
      "DiscoverGranules": {
        "name": "jk-tf-DiscoverGranules",
        "version": "$LATEST",
        "arn": "arn:aws:lambda:us-east-1:xxxxx:function:jk-tf-DiscoverGranules"
      },
      "QueueGranules": {
        "name": "jk-tf-QueueGranules",
        "version": "$LATEST",
        "arn": "arn:aws:lambda:us-east-1:xxxx:function:jk-tf-QueueGranules"
      }
```

#### New

```json
      "0": {
        "name": "jk-tf-DiscoverGranules",
        "version": "$LATEST",
        "arn": "arn:aws:lambda:us-east-1:xxxxx:function:jk-tf-DiscoverGranules"
      },
      "1": {
        "name": "jk-tf-QueueGranules",
        "version": "$LATEST",
        "arn": "arn:aws:lambda:us-east-1:xxxx:function:jk-tf-QueueGranules"
      }
```

### Actions Required

The following should be done as part of a Cumulus stack update to utilize `cumulus message adapter` > `2.0.2`:

- Python tasks that utilize [`cumulus-message-adapter-python`](https://github.com/nasa/cumulus-message-adapter-python) should be updated to use > `2.0.0`, their lambdas rebuilt and Cumulus workflows reconfigured to use the updated version.

- Python activities that utilize [`cumulus-process-py`](https://github.com/nasa/cumulus-process-py) should be rebuilt using > `1.0.0` with updated dependencies, and have their images deployed/Cumulus configured to use the new version.

- The [`cumulus-message-adapter`](https://github.com/nasa/cumulus-message-adapter) v2.0.2 lambda layer should be made available in the deployment account, and the Cumulus deployment should be reconfigured to use it (via the `cumulus_message_adapter_lambda_layer_version_arn` variable in the `cumulus` module).  This should address all Core node.js tasks that utilize the CMA, and many contributed node.js/JAVA components.

Once the above have been done, redeploy Cumulus to apply the configuration and the updates should be live.
