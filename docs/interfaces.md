---
id: interfaces
title: Interfaces
hide_title: false
---

Cumulus has multiple interfaces that allow interaction with discrete components of the system, such as starting workflows via SNS or Kinesis, manually queueing workflow start messages, submitting SNS notifications for completed workflows, and the many operations allowed by the Cumulus API.

The diagram below documents the workflow process in detail and the various interfaces that allow starting of workflows, reporting of completed workflows, and API create operations that occur when a workflow completion message is processed. Inline hyperlinks to further documentation are provided where available.

Hovering over the red text will pop up small windows that document the various schemas where applicable, with links to the most recent copy in the Cumulus source code. These schemas also include all optional fields that are shown on the Cumulus dashboard.

Note: this diagram is current of v1.11.1.

![Architecture diagram showing the interfaces for triggering and reporting of Cumulus workflow executions](../assets/interfaces.svg)
