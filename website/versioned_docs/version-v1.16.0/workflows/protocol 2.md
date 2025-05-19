---
id: version-v1.16.0-protocol
title: Workflow Protocol
hide_title: true
original_id: protocol
---

# Configuration and Message Use Diagram

![A diagram showing at which point in a workflow the Cumulus message is checked for conformity with the message schema and where the configuration is checked for conformity with the configuration schema](assets/cumulus_configuration_and_message_schema_diagram.png)

* **Configuration** - The Cumulus workflow configuration defines everything needed to describe an instance of Cumulus.
* **Scheduler** - This starts ingest of a collection on configured intervals.
* **Input to Step Functions** - The Scheduler uses the Configuration as source data to construct the input to the Workflow.
* **AWS Step Functions** - Run the workflows as kicked off by the scheduler or other processes.
* **Input to Task** - The input for each task is a JSON document that conforms to the message schema.
* **Output from Task** - The output of each task must conform to the message schemas as well and is used as the input for the subsequent task.
