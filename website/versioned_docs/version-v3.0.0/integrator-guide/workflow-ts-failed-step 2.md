---
id: version-v3.0.0-workflow-ts-failed-step
title: Workflow - Troubleshoot Failed Step(s)
hide_title: false
original_id: workflow-ts-failed-step
---

## Steps

1. Locate Step
<!-- markdownlint-disable MD029 -->

* Go to `Cumulus` dashboard
* Find the granule
* Go to `Executions` to determine the failed step

2. Investigate in Cloudwatch

* Go to `Cloudwatch`
* Locate lambda
* Search `Cloudwatch` logs

3. Recreate Error

    In your sandbox environment, try to recreate the error.

4. Resolution
<!-- markdownlint-enable MD029 -->
