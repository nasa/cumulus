import os
import json
import re
from datetime import datetime, timedelta
import uuid
from jsonpath_ng import parse
from jsonschema import validate
from .aws import stepFn, s3

class message_adapter:
    """
    transforms the cumulus message
    """
    # Maximum message payload size that will NOT be stored in S3. Anything bigger will be.
    MAX_NON_S3_PAYLOAD_SIZE = 10000

    def __init__(self, schemas=None):
        self.schemas = schemas

    def __getSfnExecutionArnByName(self, stateMachineArn, executionName):
        """
        * Given a state machine arn and execution name, returns the execution's ARN
        * @param {string} stateMachineArn The ARN of the state machine containing the execution
        * @param {string} executionName The name of the execution
        * @returns {string} The execution's ARN
        """
        return (':').join([stateMachineArn.replace(':stateMachine:', ':execution:'), executionName])

    def __getTaskNameFromExecutionHistory(self, executionHistory, arn):
        """
        * Given an execution history object returned by the StepFunctions API and an optional Activity
        * or Lambda ARN returns the most recent task name started for the given ARN, or if no ARN is
        * supplied, the most recent task started.
        *
        * IMPORTANT! If no ARN is supplied, this message assumes that the most recently started execution
        * is the desired execution. This WILL BREAK parallel executions, so always supply this if possible.
        *
        * @param {dict} executionHistory The execution history returned by getExecutionHistory, assumed
        *                             to be sorted so most recent executions come last
        * @param {string} arn An ARN to an Activity or Lambda to find. See "IMPORTANT!"
        * @throws If no matching task is found
        * @returns {string} The matching task name
        """
        eventsById = {}

        # Create a lookup table for finding events by their id
        for event in executionHistory['events']:
            eventsById[event['id']] = event

        for step in executionHistory['events']:
            # Find the ARN in thie history (the API is awful here).  When found, return its
            # previousEventId's (TaskStateEntered) name
            if (arn is not None and
                    ((step['type'] == 'LambdaFunctionScheduled' and
                      step['lambdaFunctionScheduledEventDetails']['resource'] == arn) or
                     (step['type'] == 'ActivityScheduled' and
                      step['activityScheduledEventDetails']['resource'] == arn)) and
                    'stateEnteredEventDetails' in eventsById[step['previousEventId']]):
                return eventsById[step['previousEventId']]['stateEnteredEventDetails']['name']
            elif step['type'] == 'TaskStateEntered':
                return step['stateEnteredEventDetails']['name']
        raise LookupError('No task found for ' + arn)

    def __getCurrentSfnTask(self, stateMachineArn, executionName, arn):
        """
        * Given a state machine ARN, an execution name, and an optional Activity or Lambda ARN returns
        * the most recent task name started for the given ARN in that execution, or if no ARN is
        * supplied, the most recent task started.
        *
        * IMPORTANT! If no ARN is supplied, this message assumes that the most recently started execution
        * is the desired execution. This WILL BREAK parallel executions, so always supply this if possible.
        *
        * @param {string} stateMachineArn The ARN of the state machine containing the execution
        * @param {string} executionName The name of the step function execution to look up
        * @param {string} arn An ARN to an Activity or Lambda to find. See "IMPORTANT!"
        * @returns {string} The name of the task being run
        """
        sfn = stepFn()
        executionArn = self.__getSfnExecutionArnByName(stateMachineArn, executionName)
        executionHistory = sfn.get_execution_history(
            executionArn=executionArn,
            maxResults=40,
            reverseOrder=True
        )
        return self.__getTaskNameFromExecutionHistory(executionHistory, arn)

    ##################################
    #  Input message interpretation  #
    ##################################

    # Events stored externally

    def loadRemoteEvent(self, event):
        """
        * Looks at a Cumulus message. If the message has part of its data stored remotely in
        * S3, fetches that data and returns it, otherwise it just returns the full message
        * @param {*} event The input Lambda event in the Cumulus message protocol
        * @returns {*} the full event data
        """
        if ('replace' in event):
            _s3 = s3()
            data = _s3.Object(event['replace']['Bucket'], event['replace']['Key']).get()
            if (data is not None):
                return json.loads(data['Body'].read().decode('utf-8'))
        return event

    # Loading task configuration from workload template

    def __getConfig(self, event, taskName):
        """
        * Returns the configuration for the task with the given name, or an empty object if no
        * such task is configured.
        * @param {*} event An event in the Cumulus message format with remote parts resolved
        * @param {*} taskName The name of the Cumulus task
        * @returns {*} The configuration object
        """
        config = {}
        if ('workflow_config' in event and taskName in event['workflow_config']):
            config = event['workflow_config'][taskName]
        return config

    def __loadLocalConfig(self, event):
        """
        * For local testing, returns the config for event.cumulus_meta.task
        * @param {*} event An event in the Cumulus message format with remote parts resolved
        * @returns {*} The task's configuration
        """
        return self.__getConfig(event, event['cumulus_meta']['task'])

    def __loadStepFunctionConfig(self, event, context):
        """
        * For StepFunctions, returns the configuration corresponding to the current execution
        * @param {*} event An event in the Cumulus message format with remote parts resolved
        * @param {*} context The context object passed to AWS Lambda or containing an activityArn
        * @returns {*} The task's configuration
        """
        meta = event['cumulus_meta']
        if 'invokedFunctionArn' in context:
            arn = context['invokedFunctionArn']
        else:
            arn = context.get('invoked_function_arn', context.get('activityArn'))
        taskName = self.__getCurrentSfnTask(meta['state_machine'], meta['execution_name'], arn)
        return self.__getConfig(event, taskName) if taskName is not None else None

    def __loadConfig(self, event, context):
        """
        * Given a Cumulus message and context, returns the config object for the task
        * @param {*} event An event in the Cumulus message format with remote parts resolved
        * @param {*} context The context object passed to AWS Lambda or containing an activityArn
        * @returns {*} The task's configuration
        """
        source = event['cumulus_meta']['message_source']
        if (source is None):
            raise LookupError('cumulus_meta requires a message_source')
        if (source == 'local'):
            return self.__loadLocalConfig(event)
        if (source == 'sfn'):
            return self.__loadStepFunctionConfig(event, context)

        raise LookupError('Unknown event source: ' + source)

    def __get_jsonschema(self, schema_type):
        schemas = self.schemas
        root_dir = os.environ.get("LAMBDA_TASK_ROOT", '')
        has_schema = schemas and schemas.get(schema_type)
        rel_filepath = schemas.get(schema_type) if has_schema else 'schemas/{}.json'.format(schema_type)
        filepath = os.path.join(root_dir, rel_filepath)
        return filepath if os.path.exists(filepath) else None

    def __validate_json(self, document, schema_type):
        """
        check that json is valid based on a schema
        """
        schema_filepath = self.__get_jsonschema(schema_type)
        if schema_filepath:
            schema = json.load(open(schema_filepath))
            try:
                validate(document, schema)
            except Exception as e:
                e.message = '{} schema: {}'.format(schema_type, e.message)
                raise e

    # Config templating
    def __resolvePathStr(self, event, str):
        """
        * Given a Cumulus message (AWS Lambda event) and a string containing a JSONPath
        * template to interpret, returns the result of interpreting that template.
        *
        * Templating comes in three flavors:
        *   1. Single curly-braces within a string ("some{$.path}value"). The JSONPaths
        *      are replaced by the first value they match, coerced to string
        *   2. A string surrounded by double curly-braces ("{{$.path}}").  The function
        *      returns the first object matched by the JSONPath
        *   3. A string surrounded by curly and square braces ("{[$.path]}"). The function
        *      returns an array of all object matching the JSONPath
        *
        * It's likely we'll need some sort of bracket-escaping at some point down the line
        *
        * @param {*} event The Cumulus message
        * @param {*} str A string containing a JSONPath template to resolve
        * @returns {*} The resolved object
        """
        valueRegex = '^{{.*}}$'
        arrayRegex = '^{\[.*\]}$'
        templateRegex = '{[^}]+}'

        if (re.search(valueRegex, str)):
            matchData = parse(str[2:(len(str)-2)]).find(event)
            return matchData[0].value if len(matchData) > 0 else None

        elif (re.search(arrayRegex, str)):
            matchData = parse(str[2:(len(str)-2)]).find(event)
            return [item.value for item in matchData] if len(matchData) > 0 else []

        elif (re.search(templateRegex, str)):
            matches = re.findall(templateRegex, str)
            for match in matches:
                matchData = parse(match.lstrip('{').rstrip('}')).find(event)
                if len(matchData) > 0:
                    str = str.replace(match, matchData[0].value)
            return str
        else:
            return str

        raise LookupError('Could not resolve path ' + str)

    def __resolveConfigObject(self, event, config):
        """
        * Recursive helper for resolveConfigTemplates
        *
        * Given a config object containing possible JSONPath-templated values, resolves
        * all the values in the object using JSONPaths into the provided event.
        *
        * @param {*} event The event that paths resolve against
        * @param {*} config A config object, containing paths
        * @returns {*} A config object with all JSONPaths resolved
        """

        try:
            unicode
        except NameError:
            if isinstance(config, str):
                return self.__resolvePathStr(event, config)
        else:
            if isinstance(config, unicode):
                return self.__resolvePathStr(event, config)

        if isinstance(config, list):
            for i in range(0, len(config)):
                config[i] = self.__resolveConfigObject(event, config[i])
            return config

        elif (config is not None and isinstance(config, dict)):
            result = {}
            for key in config.keys():
                result[key] = self.__resolveConfigObject(event, config[key])
            return result

        return config

    def __resolveConfigTemplates(self, event, config):
        """
        * Given a config object containing possible JSONPath-templated values, resolves
        * all the values in the object using JSONPaths into the provided event.
        *
        * @param {*} event The event that paths resolve against
        * @param {*} config A config object, containing paths
        * @returns {*} A config object with all JSONPaths resolved
        """
        taskConfig = config.copy()
        if 'cumulus_message' in taskConfig:
            del taskConfig['cumulus_message']
        return self.__resolveConfigObject(event, taskConfig)

    # Payload determination
    def __resolveInput(self, event, config):
        """
        * Given a Cumulus message and its config, returns the input object to send to the
        * task, as defined under config.cumulus_message
        * @param {*} event The Cumulus message
        * @param {*} config The config object
        * @returns {*} The object to place on the input key of the task's event
        """
        if ('cumulus_message' in config and 'input' in config['cumulus_message']):
            inputPath = config['cumulus_message']['input']
            return self.__resolvePathStr(event, inputPath)
        return event.get('payload')

    def loadNestedEvent(self, event, context):
        """
        * Interprets an incoming event as a Cumulus workflow message
        *
        * @param {*} event The input message sent to the Lambda
        * @returns {*} message that is ready to pass to an inner task
        """
        config = self.__loadConfig(event, context)
        finalConfig = self.__resolveConfigTemplates(event, config)
        finalPayload = self.__resolveInput(event, config)
        response = {'input': finalPayload}
        self.__validate_json(finalPayload, 'input')
        self.__validate_json(finalConfig, 'config')
        if finalConfig is not None:
            response['config'] = finalConfig
        if 'cumulus_message' in config:
            response['messageConfig'] = config['cumulus_message']
        return response

    #############################
    # Output message creation   #
    #############################

    def __assignJsonPathValue(self, message, jspath, value):
        """
        * Assign (update or insert) a value to message based on jsonpath.
        * Create the keys if jspath doesn't already exist in the message. In this case, we
        * support 'simple' jsonpath like $.path1.path2.path3....
        * @param {*} message The message to be update
        * @return {*} updated message
        """
        if len(parse(jspath).find(message)) > 0:
            parse(jspath).update(message, value)
        else:
            paths = jspath.lstrip('$.').split('.')
            currentItem = message
            dictPath = str()
            keyNotFound = False
            for path in paths:
                dictPath += "['" + path + "']"
                if keyNotFound or path not in currentItem:
                    keyNotFound = True
                    exec ("message" + dictPath + " = {}")
                currentItem = eval("message" + dictPath)

            exec ("message" + dictPath + " = value")
        return message

    def __assignOutputs(self, handlerResponse, event, messageConfig):
        """
        * Applies a task's return value to an output message as defined in config.cumulus_message
        *
        * @param {*} handlerResponse The task's return value
        * @param {*} event The output message to apply the return value to
        * @param {*} messageConfig The cumulus_message configuration
        * @returns {*} The output message with the nested response applied
        """
        result = event.copy()
        if messageConfig is not None and 'outputs' in messageConfig:
            outputs = messageConfig['outputs']
            result['payload'] = {}
            for output in outputs:
                sourcePath = output['source']
                destPath = output['destination']
                destJsonPath = destPath[2:(len(destPath)-2)]
                value = self.__resolvePathStr(handlerResponse, sourcePath)
                self.__assignJsonPathValue(result, destJsonPath, value)
        else:
            result['payload'] = handlerResponse

        return result

    def __storeRemoteResponse(self, event):
        """
        * Stores part of a response message in S3 if it is too big to send to StepFunctions
        * @param {*} event The response message
        * @returns {*} A response message, possibly referencing an S3 object for its contents
        """
        jsonData = json.dumps(event)
        roughDataSize = len(jsonData) if event is not None else 0

        if (roughDataSize < self.MAX_NON_S3_PAYLOAD_SIZE):
            return event

        _s3 = s3()
        s3Bucket = event['cumulus_meta']['system_bucket']
        s3Key = ('/').join(['events', str(uuid.uuid4())])
        s3Params = {
            'Expires': datetime.utcnow() + timedelta(days=7),  # Expire in a week
            'Body': jsonData if event is not None else '{}'
        }
        s3Location = {'Bucket': s3Bucket, 'Key': s3Key}

        _s3.Object(s3Bucket, s3Key).put(**s3Params)

        return {
            'cumulus_meta': event['cumulus_meta'],
            'replace': s3Location
        }

    def createNextEvent(self, handlerResponse, event, messageConfig):
        """
        * Creates the output message returned by a task
        *
        * @param {*} handlerResponse The response returned by the inner task code
        * @param {*} event The input message sent to the Lambda
        * @param {*} messageConfig The cumulus_message object configured for the task
        * @returns {*} the output message to be returned
        """
        self.__validate_json(handlerResponse, 'output')
        result = self.__assignOutputs(handlerResponse, event, messageConfig)
        result['exception'] = 'None'
        if 'replace' in result:
            del result['replace']
        return self.__storeRemoteResponse(result)
