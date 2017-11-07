'use strict';

const { Kes } = require('kes');
const forge = require('node-forge');

function generateKeyPair() {
  const rsa = forge.pki.rsa;
  console.log('Generating keys. It might take a few seconds!');
  return rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
}

function generateInputTemplates(config, outputs) {
  const template = {
    eventSource: 'sfn',
    resources: {},
    ingest_meta: {},
    provider: {},
    collection: {},
    meta: {},
    exception: null,
    payload: {}
  };

  const arns = {};
  outputs.forEach((o) => {
    arns[o.OutputKey] = o.OutputValue;
  });

  template.resources = {
    stack: config.stackName,
    kms: arns.KmsKeyId,
    cmr: config.cmr,
    distribution_endpoint: config.distributionEndpoint
  };

  // add cmr password:
  template.resources.cmr.password = arns.EncryptedCmrPassword

  if (config.buckets) {
    template.resources.buckets = config.buckets;
  }

  if (config.sqs) {
    template.resources.queues = {};
    config.sqs.forEach((q) => {
      const queueUrl = arns[`${q.name}SQSOutput`];
      if (queueUrl) {
        template.resources.queues[q.name] = queueUrl;
      }
    });
  }

  if (config.stepFunctions) {
    const sfs = {};
    config.stepFunctions.forEach((sf) => {
      sfs[sf.name] = `s3://${config.buckets.internal}/${config.stackName}/workflows/${sf.name}.json`;
    });

    template.resources.templates = sfs;
  }

  const inputs = [];

  // generate a output template for each workflow
  if (config.stepFunctions) {
    config.stepFunctions.forEach((sf) => {
      const t = Object.assign({}, template);
      t.ingest_meta = {
        topic_arn: arns.sftrackerSnsArn,
        state_machine: arns[`${sf.name}StateMachine`],
        workflow_name: sf.name,
        status: 'running',
        config: sf.config
      };
      inputs.push(t);
    });
  }

  return inputs;
}

function generateWorkflowsList(config) {
  const workflows = []
  if (config.stepFunctions) {
    config.stepFunctions.forEach((sf) => {
      const description =
      workflows.push({
        name: sf.name,
        template: `s3://${config.buckets.internal}/${config.stackName}/workflows/${sf.name}.json`,
        definition: sf.definition
      });
    });

    return workflows;
  }

  return false;
}

class UpdatedKes extends Kes {
  uploadKeyPair(bucket, key) {
    const pki = forge.pki;
    const keyPair = generateKeyPair();
    console.log('Keys Generated');

    // upload the private key
    const privateKey = pki.privateKeyToPem(keyPair.privateKey);
    const params1 = {
      Bucket: bucket,
      Key: `${key}/private.pem`,
      ACL: 'private',
      Body: privateKey
    };

    // upload the public key
    const publicKey = pki.publicKeyToPem(keyPair.publicKey);
    const params2 = {
      Bucket: bucket,
      Key: `${key}/public.pub`,
      ACL: 'private',
      Body: publicKey
    };

    return this.s3.putObject(params1).promise()
      .then(() => this.s3.putObject(params2).promise())
      .then(() => console.log('keys uploaded to S3'));
  }

  crypto() {
    const key = `${this.stack}/crypto`;

    // check if files are generated
    return this.s3.headObject({
      Key: `${key}/public.pub`,
      Bucket: this.bucket
    }).promise()
      .then(() => this.s3.headObject({
        Key: `${key}/public.pub`,
        Bucket: this.bucket
      }).promise())
      .catch(() => this.uploadKeyPair(this.bucket, key));
  }

  opsStack(ops) {
    // check if public and private key are generated
    // if not generate and upload them
    return this.crypto(this.bucket, this.stack)
      .then(() => super.opsStack(ops))
      .then(() => this.describeCF())
      .then((r) => {
        const outputs = r.Stacks[0].Outputs;
        const workflowInputs = generateInputTemplates(this.config, outputs);
        const stackName = this.stack;

        console.log('Uploading Workflow Input Templates');
        let uploads = workflowInputs.map((w) => {
          const workflowName = w.ingest_meta.workflow_name;
          const key = `${stackName}/workflows/${workflowName}.json`
          return this.uploadToS3(
            this.bucket,
            key,
            JSON.stringify(w)
          );
        });

        const workflows = generateWorkflowsList(this.config);

        if (workflows) {
          uploads.push(this.uploadToS3(
            this.bucket,
            `${stackName}/workflows/list.json`,
            JSON.stringify(workflows)
          ));
        }

        return Promise.all(uploads);
      });
  }
}

module.exports = UpdatedKes;
