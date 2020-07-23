# @cumulus/message

Utilities for building and parsing Cumulus workflow messages.

## Usage

```bash
  npm install @cumulus/message
```

## API

### Modules

<dl>
<dt><a href="#module_Build">Build</a></dt>
<dd><p>Utility functions for building Cumulus messages</p>
</dd>
<dt><a href="#module_Collections">Collections</a></dt>
<dd><p>Utility functions for generating collection information or parsing collection information
from a Cumulus message</p>
</dd>
<dt><a href="#module_Executions">Executions</a></dt>
<dd><p>Utility functions for generating execution information or parsing execution information
from a Cumulus message</p>
</dd>
<dt><a href="#module_Granules">Granules</a></dt>
<dd><p>Utility functions for parsing granule information from a Cumulus message</p>
</dd>
<dt><a href="#module_Queue">Queue</a></dt>
<dd><p>Utility functions for parsing queue information from a Cumulus message</p>
</dd>
<dt><a href="#module_StepFunctions">StepFunctions</a></dt>
<dd><p>Utility functions for working with AWS Step Function events/messages</p>
</dd>
</dl>

<a name="module_Build"></a>

### Build
Utility functions for building Cumulus messages

**Example**  
```js
const Build = require('@cumulus/message/Build');
```
<a name="exp_module_Build--exports.buildQueueMessageFromTemplate"></a>

#### exports.buildQueueMessageFromTemplate(params) ⇒ <code>CumulusMessage</code> ⏏
Build an SQS message from a workflow template for queueing executions.

**Kind**: Exported function  
**Returns**: <code>CumulusMessage</code> - A Cumulus message object  

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.provider | <code>Object</code> | A provider object |
| params.collection | <code>Object</code> | A collection object |
| params.parentExecutionArn | <code>string</code> | ARN for parent execution |
| params.messageTemplate | <code>Object</code> | Message template for the workflow |
| params.payload | <code>Object</code> | Payload for the workflow |
| params.workflow | <code>Object</code> | workflow name & arn object |
| [params.queueName] | <code>string</code> | SQS queue name |
| [params.asyncOperationId] | <code>string</code> | Async operation ID |
| [params.customCumulusMeta] | <code>Object</code> | Custom data for message.cumulus_meta |
| [params.customMeta] | <code>Object</code> | Custom data for message.meta |

<a name="module_Collections"></a>

### Collections
Utility functions for generating collection information or parsing collection information
from a Cumulus message

**Example**  
```js
const Collections = require('@cumulus/message/Collections');
```

* [Collections](#module_Collections)
    * [exports.constructCollectionId(name, version)](#exp_module_Collections--exports.constructCollectionId) ⇒ <code>string</code> ⏏
    * [exports.getCollectionIdFromMessage(message)](#exp_module_Collections--exports.getCollectionIdFromMessage) ⇒ <code>string</code> \| <code>undefined</code> ⏏

<a name="exp_module_Collections--exports.constructCollectionId"></a>

#### exports.constructCollectionId(name, version) ⇒ <code>string</code> ⏏
Returns the collection ID.

**Kind**: Exported function  
**Returns**: <code>string</code> - collectionId  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | collection name |
| version | <code>string</code> | collection version |

<a name="exp_module_Collections--exports.getCollectionIdFromMessage"></a>

#### exports.getCollectionIdFromMessage(message) ⇒ <code>string</code> \| <code>undefined</code> ⏏
Get collection ID from execution message.

**Kind**: Exported function  
**Returns**: <code>string</code> \| <code>undefined</code> - - A collection ID or undefined if
                                message.meta.collection isn't
                                present  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | An execution message |

<a name="module_Executions"></a>

### Executions
Utility functions for generating execution information or parsing execution information
from a Cumulus message

**Example**  
```js
const Executions = require('@cumulus/message/Executions');
```

* [Executions](#module_Executions)
    * [exports.buildExecutionArn(stateMachineArn, executionName)](#exp_module_Executions--exports.buildExecutionArn) ⇒ <code>string</code> ⏏
    * [exports.getExecutionUrlFromArn(executionArn)](#exp_module_Executions--exports.getExecutionUrlFromArn) ⇒ <code>string</code> ⏏
    * [exports.getStateMachineArnFromExecutionArn(executionArn)](#exp_module_Executions--exports.getStateMachineArnFromExecutionArn) ⇒ <code>string</code> ⏏
    * [exports.getMessageExecutionName(message)](#exp_module_Executions--exports.getMessageExecutionName) ⇒ <code>string</code> ⏏
    * [exports.getMessageStateMachineArn(message)](#exp_module_Executions--exports.getMessageStateMachineArn) ⇒ <code>string</code> ⏏
    * [exports.getMessageExecutionArn(message)](#exp_module_Executions--exports.getMessageExecutionArn) ⇒ <code>null</code> \| <code>string</code> ⏏

<a name="exp_module_Executions--exports.buildExecutionArn"></a>

#### exports.buildExecutionArn(stateMachineArn, executionName) ⇒ <code>string</code> ⏏
Build execution ARN from a state machine ARN and execution name

**Kind**: Exported function  
**Returns**: <code>string</code> - an execution ARN  

| Param | Type | Description |
| --- | --- | --- |
| stateMachineArn | <code>string</code> | state machine ARN |
| executionName | <code>string</code> | state machine's execution name |

<a name="exp_module_Executions--exports.getExecutionUrlFromArn"></a>

#### exports.getExecutionUrlFromArn(executionArn) ⇒ <code>string</code> ⏏
Returns execution URL from an execution ARN.

**Kind**: Exported function  
**Returns**: <code>string</code> - returns AWS console URL for the execution  

| Param | Type | Description |
| --- | --- | --- |
| executionArn | <code>string</code> | an execution ARN |

<a name="exp_module_Executions--exports.getStateMachineArnFromExecutionArn"></a>

#### exports.getStateMachineArnFromExecutionArn(executionArn) ⇒ <code>string</code> ⏏
Get state machine ARN from an execution ARN

**Kind**: Exported function  
**Returns**: <code>string</code> - a state machine ARN  

| Param | Type | Description |
| --- | --- | --- |
| executionArn | <code>string</code> | an execution ARN |

<a name="exp_module_Executions--exports.getMessageExecutionName"></a>

#### exports.getMessageExecutionName(message) ⇒ <code>string</code> ⏏
Get the execution name from a workflow message.

**Kind**: Exported function  
**Returns**: <code>string</code> - An execution name  
**Throws**:

- <code>Error</code> if there is no execution name


| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="exp_module_Executions--exports.getMessageStateMachineArn"></a>

#### exports.getMessageStateMachineArn(message) ⇒ <code>string</code> ⏏
Get the state machine ARN from a workflow message.

**Kind**: Exported function  
**Returns**: <code>string</code> - A state machine ARN  
**Throws**:

- <code>Error</code> if there is not state machine ARN


| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="exp_module_Executions--exports.getMessageExecutionArn"></a>

#### exports.getMessageExecutionArn(message) ⇒ <code>null</code> \| <code>string</code> ⏏
Get the execution ARN from a workflow message.

**Kind**: Exported function  
**Returns**: <code>null</code> \| <code>string</code> - A state machine execution ARN  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="module_Granules"></a>

### Granules
Utility functions for parsing granule information from a Cumulus message

**Example**  
```js
const Granules = require('@cumulus/message/Granules');
```
<a name="exp_module_Granules--exports.getMessageGranules"></a>

#### exports.getMessageGranules(message) ⇒ <code>Array.&lt;Object&gt;</code> \| <code>undefined</code> ⏏
Get granules from execution message.

**Kind**: Exported function  
**Returns**: <code>Array.&lt;Object&gt;</code> \| <code>undefined</code> - An array of granule objects, or
  undefined if `message.payload.granules` is not set  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | An execution message |

<a name="module_Queue"></a>

### Queue
Utility functions for parsing queue information from a Cumulus message

**Example**  
```js
const Queue = require('@cumulus/message/Queue');
```

* [Queue](#module_Queue)
    * [exports.getQueueNameByUrl(message, queueUrl)](#exp_module_Queue--exports.getQueueNameByUrl) ⇒ <code>string</code> \| <code>undefined</code> ⏏
    * [exports.getQueueName(message)](#exp_module_Queue--exports.getQueueName) ⇒ <code>string</code> ⏏
    * [exports.getMaximumExecutions(message, queueName)](#exp_module_Queue--exports.getMaximumExecutions) ⇒ <code>number</code> ⏏
    * [exports.hasQueueAndExecutionLimit(message)](#exp_module_Queue--exports.hasQueueAndExecutionLimit) ⇒ <code>boolean</code> ⏏

<a name="exp_module_Queue--exports.getQueueNameByUrl"></a>

#### exports.getQueueNameByUrl(message, queueUrl) ⇒ <code>string</code> \| <code>undefined</code> ⏏
Get queue name by URL from execution message.

**Kind**: Exported function  
**Returns**: <code>string</code> \| <code>undefined</code> - An SQS queue name or undefined  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | An execution message |
| queueUrl | <code>string</code> | An SQS queue URL |

<a name="exp_module_Queue--exports.getQueueName"></a>

#### exports.getQueueName(message) ⇒ <code>string</code> ⏏
Get the queue name from a workflow message.

**Kind**: Exported function  
**Returns**: <code>string</code> - A queue name  
**Throws**:

- <code>Error</code> if no queue name in the message


| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="exp_module_Queue--exports.getMaximumExecutions"></a>

#### exports.getMaximumExecutions(message, queueName) ⇒ <code>number</code> ⏏
Get the maximum executions for a queue.

**Kind**: Exported function  
**Returns**: <code>number</code> - Count of the maximum executions for the queue  
**Throws**:

- <code>Error</code> if no maximum executions can be found


| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |
| queueName | <code>string</code> | A queue name |

<a name="exp_module_Queue--exports.hasQueueAndExecutionLimit"></a>

#### exports.hasQueueAndExecutionLimit(message) ⇒ <code>boolean</code> ⏏
Determine if there is a queue and queue execution limit in the message.

**Kind**: Exported function  
**Returns**: <code>boolean</code> - True if there is a queue and execution limit.  

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="module_StepFunctions"></a>

### StepFunctions
Utility functions for working with AWS Step Function events/messages

**Example**  
```js
const StepFunctions = require('@cumulus/message/StepFunctions');
```

* [StepFunctions](#module_StepFunctions)
    * [exports.pullStepFunctionEvent(event)](#exp_module_StepFunctions--exports.pullStepFunctionEvent) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
    * [exports.parseStepMessage(stepMessage, stepName)](#exp_module_StepFunctions--exports.parseStepMessage) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏

<a name="exp_module_StepFunctions--exports.pullStepFunctionEvent"></a>

#### exports.pullStepFunctionEvent(event) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
Given a Step Function event, replace specified key in event with contents
of S3 remote message

**Kind**: Exported function  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Updated event with target path replaced by remote message  
**Throws**:

- <code>Error</code> if target path cannot be found on source event


| Param | Type | Description |
| --- | --- | --- |
| event | <code>Message.CumulusRemoteMessage</code> | Source event |

<a name="exp_module_StepFunctions--exports.parseStepMessage"></a>

#### exports.parseStepMessage(stepMessage, stepName) ⇒ <code>Promise.&lt;Object&gt;</code> ⏏
Parse step message with CMA keys and replace specified key in event with contents
of S3 remote message

**Kind**: Exported function  
**Returns**: <code>Promise.&lt;Object&gt;</code> - Parsed and updated event with target path replaced by remote message  

| Param | Type | Description |
| --- | --- | --- |
| stepMessage | <code>CMAMessage</code> | Message for the step |
| stepName | <code>string</code> | Name of the step |


## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

---
Generated automatically using `npm run build-docs`
