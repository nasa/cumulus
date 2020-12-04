---
id: lzards-integration
title: LZARDS Notifier Integration for Cumulus Workflows
hide-title: false
---

In order to integrate your Cumulus workflows with the EOSDIS LZARDS system, we have provided and maintain a workflow task that will notify the LZARDS API to initiate backup and archival of data.

In order to configure the LZARDS notifier task, you will need to set up the Launchpad credentials and LZARDS endpoint, and include the task in your workflow.

## Configuration & Deployment

### LZARDS Collection Configuration

In order to tell Cumulus which files to notify LZARDS of for backup, we use the `files` portion of collection configuration. This allows us to identify some, none, or all files on a granule that are to be submitted to the LZARDS archive.

Below is a partial collection definition showing the `lzards` object on a file definition used by the LZARDS notifier task:

```json
{
  "name": "COLL",
  "version": "001",
  "files": [
    {
      "bucket": "public",
      "regex": "COLL001_gran.*\\.nc",
      "sampleFileName": "COLL001_gran123A.nc",
      "lzards": {
        "backup": true
      }
    }
  ]
}
```

Setting this up ahead of time will allow you to configure which files are to be backed up before deploying the LZARDS notifier task into your workflows.

### Configure Credentials & LZARDS Endpoint

Once you have [set up your LZARDS instance and confirmed working credentials](link to LZARDS wiki doc), configure the credentials in your Terraform tfvars:

```bash
lzards_launchpad_passphrase=replace-me-passphrase
lzards_launchpad_certificate=replace-me.pfx
lzards_api=https://replace-me-lzards-host.gov/api/backups
lzards_provider=REPLACE-ME-DAAC
```

### Include the LZARDS task in your workflow

After deploying the LZARDS task, you will need to update your workflow definition to include the task. This task needs to come after your granule files have reached their final destination on S3, i.e. after `MoveGranules` if you use that, or `SyncGranules` if you don't.

In your workflow's step function definition, include a definition for a workflow step as below:

```json
{
  "LzardsBackup": {
    "Parameters": {
      "cma": {
        "event.$": "$",
        "ReplaceConfig": {
          "FullMessage": true
        },
        "task_config": {
          "placeholder": "$.meta.placeholder"
        }
      }
    },
    "Type": "Task",
    "Resource": "${lzards_backup_task_arn}",
    "Retry": [
      {
        "ErrorEquals": [
          "Lambda.ServiceException",
          "Lambda.AWSLambdaException",
          "Lambda.SdkClientException"
        ],
        "IntervalSeconds": 2,
        "MaxAttempts": 6,
        "BackoffRate": 2
      }
    ],
    "Catch": [
      {
        "ErrorEquals": [
          "States.ALL"
        ],
        "ResultPath": "$.exception",
        "Next": "WorkflowFailed"
      }
    ],
    "End": true
  }
}
```

### Running the LZARDS task

Once included, the LZARDS task will automatically become part of your ingest workflow. For those files matching collection definitions where `backup` is set to `true`, the task will notify the LZARDS API, and provide a signed URL that LZARDS will use to pull the file from S3 and process it into the LZARDS archive.
