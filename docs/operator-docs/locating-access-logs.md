---
id: locating-access-logs
title: Locating S3 Access Logs
hide_title: true
---

# Locating S3 Access Logs

When [enabling S3 Access Logs](../deployment/server_access_logging) for EMS Reporting you configured a `TargetBucket` and `TargetPrefix`.  Those together, are where you will find the raw S3 access logs.

In a standard deployment, this will be your stack's `<internal bucket name>` and a key prefix of `<stack>/ems-distribution/s3-server-access-logs/`
