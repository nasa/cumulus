# @cumulus/common

Common libraries for interacting with Cumulus ingest

## Tasks

Cumulus tasks written in node.js should extend [`Task`](./task.js) to benefit from
the protocol parsing and message interpretation it provides. A minimal task
class is as follows:

```javascript

const Task = require('@cumulus/common/task');

module.exports = class MyTask extends Task {
  run() {
    // Read inputs
    // this.config contains task configuration with all variables resolved
    // this.message contains the incoming message, with this.message.payload
    // being the input from the previous step

    // Do actual work

    // Return output, which is the incoming message with its payload overwritten
    // to contain the output of this task. The result may optionally be a promise.
    return Object.assign({}, this.message, { payload: someOutput });
  }


  /**
   * Entrypoint for Lambda
   */
  static handler(...args) {
    return MyTask.handle(...args);
  }
}
```

Several modules provide support for working with Tasks and the message protocol:

 * [@cumulus/common/config](./config.js)
   Utilities for working with configuration YAML files and resolving their resources
 * [@cumulus/common/local-helpers](./local-helpers.js):
   Provides methods for setting up message payloads for use in development / local testing
 * [@cumulus/common/step-functions](./step-functions.js):
   Provides initial inputs for step functions
 * [@cumulus/common/field-pattern](./field-pattern.js)
   String template interpretation, as used by the configuration parser
 * [@cumulus/common/message-source](./message-source.js)
   Utilities for serializing messages being sent to/from AWS Step Functions, STDIN/STDOUT, etc
 * [@cumulus/common/schema](./schema.js)
   JSON schema validation
 * [@cumulus/common/test-helpers](./test-helpers.js)
   Utilities for generating tasks and messages in unit tests

## General Utilities

 * [@cumulus/common/aws](./aws.js)
   Utilities for working with AWS. For ease of setup, testing, and credential management, code
   should obtain AWS client objects from helpers in this module.
 * [@cumulus/common/concurrency](./concurrency.js)
   Implementations of distributed concurrency primitives (mutex, semaphore) using DynamoDB
 * [@cumulus/common/errors](./errors.js)
   Classes for thrown errors
 * [@cumulus/common/log](./log.js)
   Log helpers. Code should use this instead of console.* directly to enable tagging, timestamping,
   muting or potentially shipping logs to alternative locations
 * [@cumulus/common/string](./string.js)
   Utilities for manipulating strings
 * [@cumulus/common/util](./util.js)
   Other misc general utilities
