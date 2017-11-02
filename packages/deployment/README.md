# Cumulus Deployment

This module includes cloudformation templates needed for a successful deployment of a Cumulus Instance. The templates can be used with `kes`, a node CLI helper for AWS CloudFormation.

To use this any of the templates, add this module to you project and `kes`, then run:

     $ kes cf upsert --template node_modules/cumulus/deployment/app