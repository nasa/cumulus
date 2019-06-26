---
id: delete-api-gateway-stages
title: Delete API Gateway Stages
hide_title: true
---

# Delete API Gateway Stages


### via console
An operator can do this easily through the [API Gateway Console](https://console.aws.amazon.com/apigateway/) for each of the deployed APIs `<stackname>-backend` and `<stackname>-distribution`, select and then select `stages`, finally selecting the deployed stage and then using the `Delete Stage` button.

![Sample image of API Gateway Console](assets/APIGateway-Delete-Stage.png)


### via command line
The same action can be accomplished from the command line with a script that has been added to the deployment package, `delete-stage`.  From the directory where `@cumulus/deployment` is installed, run

```sh
node_modules/.bin/delete-stage --prefix <prefix> --stage <apiStage> --doit
```
where `<prefix>` and `<apiStage>` are replaced with the correct values from your `config.yml`.
