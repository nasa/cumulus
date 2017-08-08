# StepFunction to SNS Broadcaster

This Lambda function is intended to be used as a step in Step Function.

It receives the payload and post it (the whole payload) to the sns topic specified in the ingest_meta section of the payload.
