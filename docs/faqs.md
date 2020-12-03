---
id: faqs
title: Cumulus Frequently Asked Questions
hide_title: false
---

### General

Q: How do I deploy a new instance in Cumulus?
A: For steps on the Cumulus deployment process go to [How to Deploy Cumulus](../deployment/deployment-readme).

Q: What prerequisites are needed to setup Cumulus?
A: You will need access to the AWS console, Cloudtamer.io, and an [Earthdata login](https://urs.earthdata.nasa.gov/) before you can deploy Cumulus.

Q: What is the preferred web browser for the Cumulus environment?
A: Our preferred web browser is the latest version of [Google Chrome](https://www.google.com/chrome/).

Q: How do I quickly troubleshoot an issue in Cumulus?
A: To troubleshoot and fix issues in Cumulus reference our recommended solutions in [Troubleshooting Cumulus](../troubleshooting/troubleshooting-readme).


Q: Where can I get support help?
A: The following options are available for assistance:
* Cumulus: File a bug
* AWS: You can create a case in the [AWS Support Center](https://console.aws.amazon.com/support/home), accessible via your AWS Console when logged in via CloudTamer.


### Integrators & Developers

Q: What is a Cumulus integrator?
A: Those who are working within Cumulus and AWS for deployments and to manage workflows. They may perform the following functions:

* Configure and deploy Cumulus to the AWS environment
* Configure Cumulus workflows
* Write custom workflow tasks

Q: Can I connect my Cumulus instance to ESDIS Metrics?
A: Yes, you can integrate Cloud Metrics. View details [here](../features/distribution-metrics#esdis-metrics-in-ngap) on the options available and how to connect your instance to metrics.

Q: What are the steps if I run into an issue during deployment?
A: If you encounter an issue with your deployment go to the [Troubleshooting Deployment](../troubleshooting/troubleshooting-deployment) guide.

Q: What is a Cumulus workflow?
A: A workflow is a provider-configured set of steps that describe the process to ingest data. Workflows are defined using [AWS Step Functions](https://docs.aws.amazon.com/step-functions/index.html). For more details, we suggest visiting [here](../workflows/workflows-readme).

Q: How do I set up a Cumulus workflow?
A: You will need to create a provider, have an associated collection (add a new one), and generate a new rule first. Then you can set up a Cumulus workflow by following these steps [here](../workflows/developing-a-cumulus-workflow).

Q: What are the common use cases that a Cumulus integrator encounters?
A: The following are some examples of possible use cases you may see:
* [Creating Cumulus Data Management Types](../integrator-guide/create-cumulus-data-mgmt-types)
* [Workflow: Add New Lambda](../integrator-guide/workflow-add-new-lambda)
* [Workflow: Troubleshoot Failed Step(s)](../integrator-guide/workflow-ts-failed-step)


### Operators 

Q: What is a Cumulus operator?
A: Those that ingests, archives, and troubleshoots datasets (called collections in Cumulus). Your daily activities might include but not limited to the following:

* Ingesting datasets
* Maintaining historical data ingest
* Starting and stopping data handlers
* Managing collections
* Managing provider definitions
* Creating, enabling, and disabling rules
* Investigating errors for granules and deleting or re-ingesting granules
* Investigating errors in executions and isolating failed workflow step(s)

Q: How do I set up an AWS CloudFront endpoint to serve the Cumulus Dashboard?
A: Follow the instructions in the Configuration section of Cumulus Operator Docs [here](../operator-docs/serve-dashboard-from-cloudfront).

Q: What are the common use cases that a Cumulus operator encounters?
A: The following are some examples of possible use cases you may see:
* [Kinesis Stream For Ingest](../operator-docs/kinesis-stream-for-ingest)
* [Create Rule In Cumulus](../operator-docs/create-rule-in-cumulus)
* [Granule Workflows](../operator-docs/granule-workflows)

Q: Can you re-run a workflow execution in AWS?
A: Yes. For steps on how to re-run a workflow execution go to [Re-running workflow executions](../operator-docs/rerunning-workflow-executions) in the [Cumulus Operator Docs](../operator-docs/about-operator-docs).