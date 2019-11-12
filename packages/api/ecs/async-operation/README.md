# async-operation Docker image

This image is intended for use with the AsyncOperation model. It will download
an AWS Lambda function from AWS, download a payload from S3, execute the lambda
function (inside the Docker container), then update the DynamoDB record for the
AsyncOperation with the result of the lambda function.

The Docker container expects a number of environment variables to be set:

* lambdaName - the name of the lambda function to be executed
* payloadUrl - an S3 URL containing the event to be passed to the lambda
  function
* asyncOperationsTable - the name of the AsyncOperations DynamoDB table
* asyncOperationId - the ID of the AsyncOperation record

The built image is deployed to
https://hub.docker.com/r/cumuluss/async-operation/

## Logs
Logs will be output to `${stackName}-${OperationName}EcsLogs`

## Building and Deploying

Run the following commands. Replace <build-number> with the next build number.

`docker build -t cumuluss/async-operation:<build-number> .`

`docker push cumuluss/async-operation:<build-number>`

To use the new version of the image, you must update the configuration for the AsyncOperation ECS task to point to the new version.