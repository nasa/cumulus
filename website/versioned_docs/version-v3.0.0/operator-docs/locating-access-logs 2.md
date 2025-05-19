---
id: version-v3.0.0-locating-access-logs
title: Locating S3 Access Logs
hide_title: false
original_id: locating-access-logs
---

When [enabling S3 Access Logs](../deployment/server_access_logging) for EMS Reporting you configured a `TargetBucket` and `TargetPrefix`.  Inside the `TargetBucket` at the `TargetPrefix` is where you will find the raw S3 access logs.

In a standard deployment, this will be your stack's `<internal bucket name>` and a key prefix of `<stack>/ems-distribution/s3-server-access-logs/`
