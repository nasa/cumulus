---
id: queue-post-to-cmr
title: Queue PostToCmr
hide_title: false
---

In this entry, we will walktrough handling CMR errors in workflows by queueing PostToCmr.

1. Your ingest workflow will now end with the QueueWorkflow task.
2. You can specify a queue for that task, which will then start the workflow