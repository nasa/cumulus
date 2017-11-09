# Cumulus Deployment

This module includes cloudformation templates needed for a successful deployment of a Cumulus Instance. The templates can be used with `kes`, a node CLI helper for AWS CloudFormation.

## Usage

1. Copy `app.example` to a new deployment project.
2. Edit `app.example/config.yml` and your deployment information

3. Rename `app.example` to `app`.
4. Execute kes command:

     $ ./node_modules/.bin/kes cf deploy --kes-folder app --deployment <my-deployment> --template node_modules/cumulus/deployment/app