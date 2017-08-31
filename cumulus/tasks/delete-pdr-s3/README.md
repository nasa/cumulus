# Delete PDR S3 Task

This project provides an AWS step function task that will delete a PDR from an S3 bucket,
usually to allow it to be reprocessed if something went wrong, like the provider gateway
timing out.