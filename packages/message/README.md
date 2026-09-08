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
</dl>

### Functions

<dl>
<dt><a href="#exp_module_AsyncOperations--getMessageAsyncOperationId">getMessageAsyncOperationId(message)</a> ⇒ <code>undefined</code> | <code>string</code> ⏏</dt>
<dd><p>Get the async operation ID from a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_Collections--constructCollectionId">constructCollectionId(name, version)</a> ⇒ <code>string</code> ⏏</dt>
<dd><p>Returns the collection ID.</p>
</dd>
<dt><a href="#exp_module_Collections--deconstructCollectionId">deconstructCollectionId(collectionId)</a> ⇒ ⏏</dt>
<dd><p>Returns the name and version of a collection based on
the collectionId used in elasticsearch indexing</p>
</dd>
<dt><a href="#exp_module_Collections--getCollectionNameAndVersionFromMessage">getCollectionNameAndVersionFromMessage(message)</a> ⇒ <code>CollectionInfo</code> | <code>undefined</code> ⏏</dt>
<dd><p>Get collection name and version from execution message.</p>
</dd>
<dt><a href="#exp_module_Collections--getCollectionIdFromMessage">getCollectionIdFromMessage(message)</a> ⇒ <code>string</code> | <code>undefined</code> ⏏</dt>
<dd><p>Get collection ID from execution message.</p>
</dd>
<dt><a href="#isCumulusMessageLike">isCumulusMessageLike()</a></dt>
<dd><p>Bare check for CumulusMessage Shape</p>
</dd>
<dt><a href="#isDLQRecordLike">isDLQRecordLike()</a></dt>
<dd><p>Bare check for SQS message Shape</p>
</dd>
<dt><a href="#unwrapDeadLetterCumulusMessage">unwrapDeadLetterCumulusMessage()</a></dt>
<dd><p>Unwrap dead letter Cumulus message, which may be wrapped in a
States cloudwatch event, which is wrapped in an SQS message.</p>
</dd>
<dt><a href="#extractSQSMetadata">extractSQSMetadata(message)</a> ⇒</dt>
<dd><p>peel out metadata from an SQS(/DLQ)record</p>
</dd>
<dt><a href="#hoistCumulusMessageDetails">hoistCumulusMessageDetails()</a></dt>
<dd><p>Reformat object with key attributes at top level.</p>
</dd>
<dt><a href="#exp_module_PDRs--getMessagePdr">getMessagePdr(message)</a> ⇒ <code>undefined</code> | <code>Object</code> ⏏</dt>
<dd><p>Get the PDR object from a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_PDRs--messageHasPdr">messageHasPdr(message)</a> ⇒ <code>boolean</code> ⏏</dt>
<dd><p>Determine if message has a PDR.</p>
</dd>
<dt><a href="#exp_module_PDRs--getMessagePdrPANSent">getMessagePdrPANSent(message)</a> ⇒ <code>boolean</code> ⏏</dt>
<dd><p>Get the PAN sent status from a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_PDRs--getMessagePdrPANMessage">getMessagePdrPANMessage(message)</a> ⇒ <code>string</code> ⏏</dt>
<dd><p>Get the PAN message status from a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_PDRs--getMessagePdrName">getMessagePdrName(message)</a> ⇒ <code>string</code> ⏏</dt>
<dd><p>Get the PDR name from a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_PDRs--getMessagePdrRunningExecutions">getMessagePdrRunningExecutions(message)</a> ⇒ <code>number</code> ⏏</dt>
<dd><p>Get the number of running executions for a PDR, if any.</p>
</dd>
<dt><a href="#exp_module_PDRs--getMessagePdrCompletedExecutions">getMessagePdrCompletedExecutions(message)</a> ⇒ <code>number</code> ⏏</dt>
<dd><p>Get the number of completed executions for a PDR, if any.</p>
</dd>
<dt><a href="#exp_module_PDRs--getMessagePdrFailedExecutions">getMessagePdrFailedExecutions(message)</a> ⇒ <code>number</code> ⏏</dt>
<dd><p>Get the number of failed executions for a PDR, if any.</p>
</dd>
<dt><a href="#exp_module_PDRs--getMessagePdrStats">getMessagePdrStats(message)</a> ⇒ <code>PdrStats</code> ⏏</dt>
<dd><p>Get the PDR stats from a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_PDRs--getPdrPercentCompletion">getPdrPercentCompletion(stats)</a> ⇒ <code>number</code> ⏏</dt>
<dd><p>Get the percent completion of PDR executions</p>
</dd>
<dt><a href="#exp_module_Executions--generatePdrApiRecordFromMessage">generatePdrApiRecordFromMessage(message, [updatedAt])</a> ⇒ <code>ApiPdr</code> ⏏</dt>
<dd><p>Generate a PDR record for the API from the message.</p>
</dd>
<dt><a href="#exp_module_Providers--getMessageProvider">getMessageProvider(message)</a> ⇒ <code>MessageProvider</code> | <code>string</code> ⏏</dt>
<dd><p>Get the provider from a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_Providers--getMessageProviderId">getMessageProviderId(message)</a> ⇒ <code>undefined</code> | <code>string</code> ⏏</dt>
<dd><p>Get the provider ID from a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_StepFunctions--pullStepFunctionEvent">pullStepFunctionEvent(event)</a> ⇒ <code>Promise.&lt;object&gt;</code> ⏏</dt>
<dd><p>Given a Step Function event, replace specified key in event with contents
of S3 remote message</p>
</dd>
<dt><a href="#exp_module_StepFunctions--parseStepMessage">parseStepMessage(stepMessage, stepName)</a> ⇒ <code>Promise.&lt;object&gt;</code> ⏏</dt>
<dd><p>Parse step message with CMA keys and replace specified key in event with contents
of S3 remote message</p>
</dd>
<dt><a href="#getFailedStepName">getFailedStepName(events, failedStepEvent)</a> ⇒ <code>string</code></dt>
<dd><p>Searches the Execution step History for the TaskStateEntered pertaining to
the failed task Id.  HistoryEvent ids are numbered sequentially, starting at
one.</p>
</dd>
<dt><a href="#lastFailedEventStep">lastFailedEventStep(events)</a> ⇒ <code>Array.&lt;HistoryEvent&gt;</code> | <code>undefined</code></dt>
<dd><p>Finds all failed execution events and returns the last one in the list.</p>
</dd>
<dt><a href="#getFailedExecutionMessage">getFailedExecutionMessage(inputCumulusMessage, getExecutionHistoryFunction)</a> ⇒ <code>Object</code></dt>
<dd><p>Get message to use for publishing failed execution notifications.</p>
<p>Try to get the input to the last failed step in the execution so we can
update the status of any granules/PDRs that don&#39;t exist in the initial execution
input.</p>
<p>Falls back to overall execution input.</p>
</dd>
<dt><a href="#isFileExtensionMatched">isFileExtensionMatched(granuleFile, extension)</a> ⇒ <code>boolean</code></dt>
<dd><p>Check if the file has the extension</p>
</dd>
<dt><a href="#parseException">parseException(exception)</a> ⇒ <code>string</code></dt>
<dd><p>Ensures that the exception is returned as an object</p>
</dd>
<dt><a href="#exp_module_workflows--getMetaStatus">getMetaStatus(message)</a> ⇒ <code>Message.WorkflowStatus</code> | <code>undefined</code> ⏏</dt>
<dd><p>Get the status of a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_workflows--getMessageWorkflowTasks">getMessageWorkflowTasks(message)</a> ⇒ <code>Object</code> | <code>undefined</code> ⏏</dt>
<dd><p>Get the workflow tasks in a workflow message, if any.</p>
</dd>
<dt><a href="#exp_module_workflows--getMessageWorkflowStartTime">getMessageWorkflowStartTime(message)</a> ⇒ <code>number</code> | <code>undefined</code> ⏏</dt>
<dd><p>Get the workflow start time, if any.</p>
</dd>
<dt><a href="#exp_module_workflows--getMessageWorkflowStopTime">getMessageWorkflowStopTime(message)</a> ⇒ <code>number</code> | <code>undefined</code> ⏏</dt>
<dd><p>Get the workflow stop time, if any.</p>
</dd>
<dt><a href="#exp_module_workflows--getMessageWorkflowName">getMessageWorkflowName(message)</a> ⇒ <code>string</code> | <code>undefined</code> ⏏</dt>
<dd><p>Get the workflow name, if any.</p>
</dd>
<dt><a href="#exp_module_workflows--getWorkflowDuration">getWorkflowDuration(startTime, [stopTime])</a> ⇒ <code>number</code> ⏏</dt>
<dd><p>Get the workflow duration.</p>
</dd>
</dl>

<a name="module_Build"></a>

### Build
Utility functions for building Cumulus messages

**Example**
```js
const Build = require('@cumulus/message/Build');
```
<a name="exp_module_Build--buildQueueMessageFromTemplate"></a>

#### buildQueueMessageFromTemplate(params) ⇒ <code>Message.CumulusMessage</code> ⏏
Build an SQS message from a workflow template for queueing executions.

**Kind**: Exported function
**Returns**: <code>Message.CumulusMessage</code> - A Cumulus message object

| Param | Type | Description |
| --- | --- | --- |
| params | <code>Object</code> |  |
| params.provider | <code>Object</code> | A provider object |
| params.collection | <code>Object</code> | A collection object |
| params.parentExecutionArn | <code>string</code> | ARN for parent execution |
| params.messageTemplate | <code>Object</code> | Message template for the workflow |
| params.payload | <code>Object</code> | Payload for the workflow |
| params.workflow | <code>Object</code> | workflow name & arn object |
| [params.asyncOperationId] | <code>string</code> | Async operation ID |
| [params.customCumulusMeta] | <code>Object</code> | Custom data for message.cumulus_meta |
| [params.customMeta] | <code>Object</code> | Custom data for message.meta |
| [params.executionNamePrefix] | <code>string</code> | Prefix to apply to the name   of the enqueued execution |

<a name="module_Executions"></a>

### Executions
Utility functions for generating execution information or parsing execution information
from a Cumulus message

**Example**
```js
const Executions = require('@cumulus/message/Executions');
```

* [Executions](#module_Executions)
    * [buildExecutionArn(stateMachineArn, executionName)](#exp_module_Executions--buildExecutionArn) ⇒ <code>string</code> ⏏
    * [getExecutionUrlFromArn(executionArn)](#exp_module_Executions--getExecutionUrlFromArn) ⇒ <code>string</code> ⏏
    * [getStateMachineArnFromExecutionArn(executionArn)](#exp_module_Executions--getStateMachineArnFromExecutionArn) ⇒ <code>string</code> ⏏
    * [getMessageExecutionName(message)](#exp_module_Executions--getMessageExecutionName) ⇒ <code>string</code> ⏏
    * [getMessageStateMachineArn(message)](#exp_module_Executions--getMessageStateMachineArn) ⇒ <code>string</code> ⏏
    * [getMessageExecutionArn(message)](#exp_module_Executions--getMessageExecutionArn) ⇒ <code>null</code> \| <code>string</code> ⏏
    * [getMessageExecutionParentArn(message)](#exp_module_Executions--getMessageExecutionParentArn) ⇒ <code>undefined</code> \| <code>string</code> ⏏
    * [getMessageCumulusVersion(message)](#exp_module_Executions--getMessageCumulusVersion) ⇒ <code>undefined</code> \| <code>string</code> ⏏
    * [getMessageExecutionOriginalPayload(message)](#exp_module_Executions--getMessageExecutionOriginalPayload) ⇒ <code>unknown</code> \| <code>undefined</code> ⏏
    * [getMessageExecutionFinalPayload(message)](#exp_module_Executions--getMessageExecutionFinalPayload) ⇒ <code>unknown</code> \| <code>undefined</code> ⏏
    * [generateExecutionApiRecordFromMessage(message, [updatedAt])](#exp_module_Executions--generateExecutionApiRecordFromMessage) ⇒ <code>ApiExecution</code> ⏏
    * _global_
        * [generatePdrApiRecordFromMessage(message, [updatedAt])](#exp_module_Executions--generatePdrApiRecordFromMessage) ⇒ <code>ApiPdr</code> ⏏

<a name="exp_module_Executions--buildExecutionArn"></a>

#### buildExecutionArn(stateMachineArn, executionName) ⇒ <code>string</code> ⏏
Build execution ARN from a state machine ARN and execution name

**Kind**: Exported function
**Returns**: <code>string</code> - an execution ARN

| Param | Type | Description |
| --- | --- | --- |
| stateMachineArn | <code>string</code> | state machine ARN |
| executionName | <code>string</code> | state machine's execution name |

<a name="exp_module_Executions--getExecutionUrlFromArn"></a>

#### getExecutionUrlFromArn(executionArn) ⇒ <code>string</code> ⏏
Returns execution URL from an execution ARN.

**Kind**: Exported function
**Returns**: <code>string</code> - returns AWS console URL for the execution

| Param | Type | Description |
| --- | --- | --- |
| executionArn | <code>string</code> | an execution ARN |

<a name="exp_module_Executions--getStateMachineArnFromExecutionArn"></a>

#### getStateMachineArnFromExecutionArn(executionArn) ⇒ <code>string</code> ⏏
Get state machine ARN from an execution ARN

**Kind**: Exported function
**Returns**: <code>string</code> - a state machine ARN

| Param | Type | Description |
| --- | --- | --- |
| executionArn | <code>string</code> | an execution ARN |

<a name="exp_module_Executions--getMessageExecutionName"></a>

#### getMessageExecutionName(message) ⇒ <code>string</code> ⏏
Get the execution name from a workflow message.

**Kind**: Exported function
**Returns**: <code>string</code> - An execution name
**Throws**:

- <code>Error</code> if there is no execution name


| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="exp_module_Executions--getMessageStateMachineArn"></a>

#### getMessageStateMachineArn(message) ⇒ <code>string</code> ⏏
Get the state machine ARN from a workflow message.

**Kind**: Exported function
**Returns**: <code>string</code> - A state machine ARN
**Throws**:

- <code>Error</code> if there is not state machine ARN


| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="exp_module_Executions--getMessageExecutionArn"></a>

#### getMessageExecutionArn(message) ⇒ <code>null</code> \| <code>string</code> ⏏
Get the execution ARN from a workflow message.

**Kind**: Exported function
**Returns**: <code>null</code> \| <code>string</code> - A state machine execution ARN

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="exp_module_Executions--getMessageExecutionParentArn"></a>

#### getMessageExecutionParentArn(message) ⇒ <code>undefined</code> \| <code>string</code> ⏏
Get the parent execution ARN from a workflow message, if any.

**Kind**: Exported function
**Returns**: <code>undefined</code> \| <code>string</code> - A state machine execution ARN

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="exp_module_Executions--getMessageCumulusVersion"></a>

#### getMessageCumulusVersion(message) ⇒ <code>undefined</code> \| <code>string</code> ⏏
Get the Cumulus version from a workflow message, if any.

**Kind**: Exported function
**Returns**: <code>undefined</code> \| <code>string</code> - The cumulus version

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="exp_module_Executions--getMessageExecutionOriginalPayload"></a>

#### getMessageExecutionOriginalPayload(message) ⇒ <code>unknown</code> \| <code>undefined</code> ⏏
Get the workflow original payload, if any.

**Kind**: Exported function
**Returns**: <code>unknown</code> \| <code>undefined</code> - The workflow original payload

| Param | Type | Description |
| --- | --- | --- |
| message | <code>MessageWithPayload</code> | A workflow message object |

<a name="exp_module_Executions--getMessageExecutionFinalPayload"></a>

#### getMessageExecutionFinalPayload(message) ⇒ <code>unknown</code> \| <code>undefined</code> ⏏
Get the workflow final payload, if any.

**Kind**: Exported function
**Returns**: <code>unknown</code> \| <code>undefined</code> - The workflow final payload

| Param | Type | Description |
| --- | --- | --- |
| message | <code>MessageWithPayload</code> | A workflow message object |

<a name="exp_module_Executions--generateExecutionApiRecordFromMessage"></a>

#### generateExecutionApiRecordFromMessage(message, [updatedAt]) ⇒ <code>ApiExecution</code> ⏏
Generate an execution record for the API from the message.

**Kind**: Exported function
**Returns**: <code>ApiExecution</code> - An execution API record

| Param | Type | Description |
| --- | --- | --- |
| message | <code>MessageWithPayload</code> | A workflow message object |
| [updatedAt] | <code>string</code> | Optional updated timestamp to apply to record |

<a name="exp_module_Executions--generatePdrApiRecordFromMessage"></a>

#### generatePdrApiRecordFromMessage(message, [updatedAt]) ⇒ <code>ApiPdr</code> ⏏
Generate a PDR record for the API from the message.

**Kind**: global method of [<code>Executions</code>](#module_Executions)
**Returns**: <code>ApiPdr</code> - An PDR API record

| Param | Type | Description |
| --- | --- | --- |
| message | <code>MessageWithOptionalPayloadPdr</code> | A workflow message object |
| [updatedAt] | <code>string</code> | Optional updated timestamp to apply to record |

<a name="module_Granules"></a>

### Granules
Utility functions for parsing granule information from a Cumulus message

**Example**
```js
const Granules = require('@cumulus/message/Granules');
```

* [Granules](#module_Granules)
    * [getMessageGranules(message)](#exp_module_Granules--getMessageGranules) ⇒ <code>Array.&lt;object&gt;</code> \| <code>undefined</code> ⏏
    * [messageHasGranules(message)](#exp_module_Granules--messageHasGranules) ⇒ <code>boolean</code> ⏏
    * [getGranuleStatus(workflowStatus, granule)](#exp_module_Granules--getGranuleStatus) ⇒ <code>string</code> ⏏
    * [getGranuleQueryFields(message)](#exp_module_Granules--getGranuleQueryFields) ⇒ <code>unknown</code> \| <code>undefined</code> ⏏
    * [generateGranuleApiRecord(message)](#exp_module_Granules--generateGranuleApiRecord) ⇒ <code>Promise.&lt;ApiGranule&gt;</code> ⏏

<a name="exp_module_Granules--getMessageGranules"></a>

#### getMessageGranules(message) ⇒ <code>Array.&lt;object&gt;</code> \| <code>undefined</code> ⏏
Get granules from payload?.granules of a workflow message.

**Kind**: Exported function
**Returns**: <code>Array.&lt;object&gt;</code> \| <code>undefined</code> - An array of granule objects, or
  undefined if `message.payload.granules` is not set

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message |

<a name="exp_module_Granules--messageHasGranules"></a>

#### messageHasGranules(message) ⇒ <code>boolean</code> ⏏
Determine if message has a granules object.

**Kind**: Exported function
**Returns**: <code>boolean</code> - true if message has a granules object

| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |

<a name="exp_module_Granules--getGranuleStatus"></a>

#### getGranuleStatus(workflowStatus, granule) ⇒ <code>string</code> ⏏
Determine the status of a granule.

**Kind**: Exported function
**Returns**: <code>string</code> - The granule status

| Param | Type | Description |
| --- | --- | --- |
| workflowStatus | <code>string</code> | The workflow status |
| granule | <code>MessageGranule</code> | A granule record conforming to the 'api' schema |

<a name="exp_module_Granules--getGranuleQueryFields"></a>

#### getGranuleQueryFields(message) ⇒ <code>unknown</code> \| <code>undefined</code> ⏏
Get the query fields of a granule, if any

**Kind**: Exported function
**Returns**: <code>unknown</code> \| <code>undefined</code> - The granule query fields, if any

| Param | Type | Description |
| --- | --- | --- |
| message | <code>MessageWithGranules</code> | A workflow message |

<a name="exp_module_Granules--generateGranuleApiRecord"></a>

#### generateGranuleApiRecord(message) ⇒ <code>Promise.&lt;ApiGranule&gt;</code> ⏏
Generate an API granule record

**Kind**: Exported function
**Returns**: <code>Promise.&lt;ApiGranule&gt;</code> - The granule API record

| Param | Type | Description |
| --- | --- | --- |
| message | <code>MessageWithGranules</code> | A workflow message |

<a name="module_Queue"></a>

### Queue
Utility functions for parsing queue information from a Cumulus message

**Example**
```js
const Queue = require('@cumulus/message/Queue');
```

* [Queue](#module_Queue)
    * [getQueueUrl(message)](#exp_module_Queue--getQueueUrl) ⇒ <code>string</code> ⏏
    * [getMaximumExecutions(message, queueUrl)](#exp_module_Queue--getMaximumExecutions) ⇒ <code>number</code> ⏏
    * [hasQueueAndExecutionLimit(message)](#exp_module_Queue--hasQueueAndExecutionLimit) ⇒ <code>boolean</code> ⏏

<a name="exp_module_Queue--getQueueUrl"></a>

#### getQueueUrl(message) ⇒ <code>string</code> ⏏
Get the queue URL from a workflow message.

**Kind**: Exported function
**Returns**: <code>string</code> - A queue URL

| Param | Type | Description |
| --- | --- | --- |
| message | <code>MessageWithQueueInfo</code> | A workflow message object |

<a name="exp_module_Queue--getMaximumExecutions"></a>

#### getMaximumExecutions(message, queueUrl) ⇒ <code>number</code> ⏏
Get the maximum executions for a queue.

**Kind**: Exported function
**Returns**: <code>number</code> - Count of the maximum executions for the queue
**Throws**:

- <code>Error</code> if no maximum executions can be found


| Param | Type | Description |
| --- | --- | --- |
| message | <code>Message.CumulusMessage</code> | A workflow message object |
| queueUrl | <code>string</code> | A queue URL |

<a name="exp_module_Queue--hasQueueAndExecutionLimit"></a>

#### hasQueueAndExecutionLimit(message) ⇒ <code>boolean</code> ⏏
Determine if there is a queue and queue execution limit in the message.

**Kind**: Exported function
**Returns**: <code>boolean</code> - True if there is a queue and execution limit.

| Param | Type | Description |
| --- | --- | --- |
| message | <code>MessageWithQueueInfo</code> | A workflow message object |

<a name="isCumulusMessageLike"></a>

### isCumulusMessageLike()
Bare check for CumulusMessage Shape

**Kind**: global function
<a name="isDLQRecordLike"></a>

### isDLQRecordLike()
Bare check for SQS message Shape

**Kind**: global function
<a name="unwrapDeadLetterCumulusMessage"></a>

### unwrapDeadLetterCumulusMessage()
Unwrap dead letter Cumulus message, which may be wrapped in a
States cloudwatch event, which is wrapped in an SQS message.

**Kind**: global function
<a name="extractSQSMetadata"></a>

### extractSQSMetadata(message) ⇒
peel out metadata from an SQS(/DLQ)record

**Kind**: global function
**Returns**: the given message without its body

| Param | Description |
| --- | --- |
| message | DLQ or SQS message |

<a name="hoistCumulusMessageDetails"></a>

### hoistCumulusMessageDetails()
Reformat object with key attributes at top level.

**Kind**: global function
<a name="getFailedStepName"></a>

### getFailedStepName(events, failedStepEvent) ⇒ <code>string</code>
Searches the Execution step History for the TaskStateEntered pertaining to
the failed task Id.  HistoryEvent ids are numbered sequentially, starting at
one.

**Kind**: global function
**Returns**: <code>string</code> - name of the current stepfunction task or 'UnknownFailedStepName'.

| Param | Type | Description |
| --- | --- | --- |
| events | <code>Array.&lt;HistoryEvent&gt;</code> | Step Function events array |
| failedStepEvent | <code>failedStepEvent</code> | Step Function's failed event. |
| failedStepEvent.id |  | number (long), Step Functions failed event id. |

<a name="lastFailedEventStep"></a>

### lastFailedEventStep(events) ⇒ <code>Array.&lt;HistoryEvent&gt;</code> \| <code>undefined</code>
Finds all failed execution events and returns the last one in the list.

**Kind**: global function
**Returns**: <code>Array.&lt;HistoryEvent&gt;</code> \| <code>undefined</code> - - the last lambda or activity that failed in the
event array, or an empty array.

| Param | Type | Description |
| --- | --- | --- |
| events | <code>Array.&lt;HistoryEvent&gt;</code> | array of AWS Stepfunction execution HistoryEvents |

<a name="getFailedExecutionMessage"></a>

### getFailedExecutionMessage(inputCumulusMessage, getExecutionHistoryFunction) ⇒ <code>Object</code>
Get message to use for publishing failed execution notifications.

Try to get the input to the last failed step in the execution so we can
update the status of any granules/PDRs that don't exist in the initial execution
input.

Falls back to overall execution input.

**Kind**: global function
**Returns**: <code>Object</code> - - CumulusMessage Execution step message or execution input message

| Param | Type | Description |
| --- | --- | --- |
| inputCumulusMessage | <code>Object</code> | Workflow execution input message |
| getExecutionHistoryFunction | <code>function</code> | Testing override for mock/etc of                                                 StepFunctions.getExecutionHistory |

<a name="isFileExtensionMatched"></a>

### isFileExtensionMatched(granuleFile, extension) ⇒ <code>boolean</code>
Check if the file has the extension

**Kind**: global function
**Returns**: <code>boolean</code> - whether the file has the extension

| Param | Type | Description |
| --- | --- | --- |
| granuleFile | <code>ApiFile</code> | Granule file |
| extension | <code>string</code> | File extension to check |

<a name="parseException"></a>

### parseException(exception) ⇒ <code>string</code>
Ensures that the exception is returned as an object

**Kind**: global function
**Returns**: <code>string</code> - an stringified exception

| Param | Type | Description |
| --- | --- | --- |
| exception | <code>Object</code> \| <code>undefined</code> | the exception |


## About Cumulus

Cumulus is a cloud-based data ingest, archive, distribution and management prototype for NASA's future Earth science data streams.

[Cumulus Documentation](https://nasa.github.io/cumulus)

## Contributing

To make a contribution, please [see our contributing guidelines](https://github.com/nasa/cumulus/blob/master/CONTRIBUTING.md).

---
Generated automatically using `npm run build-docs`
