---
id: external-contributions
title: External Contributions
hide_title: false
---

Contributions to Cumulus may be made in the form of [PRs to the repositories directly](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md) or through externally developed tasks and components. Cumulus is designed as an ecosystem that leverages Terraform deployments and AWS Step Functions to easily integrate external components.

This list may not be exhaustive and represents components that are open source, owned externally,  and that have been tested with the Cumulus system. For more information and contributing guidelines, visit the respective GitHub repositories.

## Distribution

[The ASF Thin Egress App](https://github.com/asfadmin/thin-egress-app#welcome-to-tea---the-thin-egress-app) is used by Cumulus for distribution. TEA can be deployed [with Cumulus](../deployment/thin_egress_app) or as part of other applications to distribute data.

## Operational Cloud Recovery Archive (ORCA)

[ORCA](https://nasa.github.io/cumulus-orca/) can be [deployed with Cumulus](https://nasa.github.io/cumulus-orca/docs/developer/deployment-guide/deployment) to provide a customizable baseline for creating and managing operational backups.

## Workflow Tasks

### CNM

PO.DAAC provides two workflow tasks to be used with the [Cloud Notification Mechanism (CNM) Schema](https://github.com/podaac/cloud-notification-message-schema#cumulus-sns-schema): [CNM to Granule](https://github.com/podaac/cumulus-cnm-to-granule#cnm-to-granule-task) and [CNM Response](https://github.com/podaac/cumulus-cnm-response-task#cnm-response-task).

See the [CNM workflow data cookbook](../data-cookbooks/cnm-workflow) for an example of how these can be used in a Cumulus ingest workflow.

### DMR++ Generation

GHRC has provided a [DMR++ Generation](https://github.com/ghrcdaac/dmrpp-generator#overview) wokrflow task. This task is meant to be used in conjunction with Cumulus' [Hyrax Metadata Updates workflow task](https://github.com/nasa/cumulus/tree/master/tasks/hyrax-metadata-updates#cumulushyrax-metadata-updates).
