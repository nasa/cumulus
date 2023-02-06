---
id: version-v1.14.0-delete-api-gateway-stages
title: Delete API Gateway Stages
hide_title: true
original_id: delete-api-gateway-stages
---

# Delete API Gateway Stages


### via console
An operator can easily delete an existing API Gateway stage through the [API Gateway Console](https://console.aws.amazon.com/apigateway/). For each of the deployed APIs `<stackname>-backend` and `<stackname>-distribution`, select the API and then select `stages`, finally select the deployed stage and use the `Delete Stage` button.

![Sample image of API Gateway Console](assets/APIGateway-Delete-Stage.png)


### via command line
The same action can be accomplished from the command line with a script that has been added to the deployment package, `delete-stage`.  From the directory where `@cumulus/deployment` is installed.  This will use your stack `prefix` and stage name to query AWS and correctly delete stages on all restApis that begin with `<prefix>-`, so you only need to run this script one-time to delete the stages from the Distribution API and the Backend API.

Ensure your `AWS_REGION` environment is set properly and then run:

```sh
node_modules/.bin/delete-stage --prefix <prefix> --stage <apiStage> --doit
```

Where `<prefix>` and `<apiStage>` are replaced with the correct values from your `config.yml`.  In the example above, those would be `jc` and `dev`.
