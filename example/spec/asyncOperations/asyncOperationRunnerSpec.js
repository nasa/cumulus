'use strict';

describe("The API's ECS Lambda runner", () => {
  it('does not run the task if the asyncOperationId environment variable is not set');

  it('does not run the task if the asyncOperationsTable environment variable is not set');

  it('does not run the task if the lambdaName environment variable is not set');

  it('does not run the task if the payloadUrl environment variable is not set');

  describe('running a non-existant lambda function', () => {
    it('updates the status field in DynamoDB to "FAILED"');
    it('updates the error field in DynamoDB');
    it('updates the updatedAt field in DynamoDB');
    it('does not set the result field in DynamoDB');
  });

  describe('with a non-existant payload', () => {
    it('updates the status field in DynamoDB to "FAILED"');
    it('updates the error field in DynamoDB');
    it('updates the updatedAt field in DynamoDB');
    it('does not set the result field in DynamoDB');
  });

  describe('with a non-JSON payload', () => {
    it('updates the status field in DynamoDB to "FAILED"');
    it('updates the error field in DynamoDB');
    it('updates the updatedAt field in DynamoDB');
    it('does not set the result field in DynamoDB');
  });

  it('executing a successful lambda function', () => {
    it('updates the status field in DynamoDB to "SUCCEEDED"');
    it('updates the result field in DynamoDB');
    it('updates the updatedAt field in DynamoDB');
    it('does not set the error field in DynamoDB');
  });

  describe('executing a failing lambda function', () => {
    it('updates the status field in DynamoDB to "FAILED"');
    it('updates the error field in DynamoDB');
    it('updates the updatedAt field in DynamoDB');
    it('does not set the result field in DynamoDB');
  });
});
