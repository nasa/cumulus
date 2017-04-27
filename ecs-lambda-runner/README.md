# ECS Lambda Runner

A Docker image which pulls (node.js) a function from Lambda and runs it with given event data,
allowing more seamless migration of functions between ECS and Lambda as resources require.

## Useful Commands

To build:

```
$ npm run docker:build
```

To run locally:
```
$ node index.js <lambda-fn-name> --eventJson <event-json>
#
```

To run in Docker locally:
```
$ docker run -e AWS_ACCESS_KEY_ID='<aws-access-key>' -e AWS_SECRET_ACCESS_KEY='<aws-secret-key>' gitc/ecs-lambda-runner <lambda-fn-name> --eventJson <event-json>
```

To deploy to the AWS repo:

```
$ export AWS_ACCOUNT_ID=<your-account-id>
$ npm run docker:deploy
```

To clean up local deployments after repeated builds:

```
$ npm run docker:clean

```