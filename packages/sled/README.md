# Cumulus sled (Javascript)

Implements an AWS Lambda handler that adapts incoming messages in the Cumulus protocol
to a format more easily consumable by Cumulus tasks, invokes the tasks, and then adapts
their response back to the Cumulus message protocol to be sent to the next task.

Tasks being run within a sled are written as AWS Lambda handlers themselves, receiving
the usual `event`, `context`, and `callback` arguments.  Their `event` object, however,
contains only two keys:

  * `input`: The task's input, typically the `payload` of the message, produced at runtime
  * `config`: The task's configuration, with any templated variables resolved

Tasks return or call back with their logical output, which typically goes in the `payload`
of the resulting Cumulus message.

Expectations for input, config, and return values are all defined by the tasks, and should
be well documented. Tasks should thoughtfully consider their inputs and return values, as
breaking changes may have cascading effects on tasks throughout a workflow. Configuration
changes are slightly less impactful, but must be communicated to those using the task.

## Examples

[example/](example/) contains an example handler that prints some diagnostics and returns its event.

[example/messages/](example/messages/) contains example inputs and outputs produced by the handler.

To run the example, execute `node index.js local <message-name>` in this directory, where
`<message-name>` is the basename of the example message under `example/messages/` to use as input
and output, e.g. `basic` or `jsonpath`.

## Use

To use the sled:

1. Update the task in question to accept/return the above inputs and outputs. Remove all code
   dealing with the Cumulus message protocol.
2. Add a `cumulus.json` file to the root of the task. It should look like the following:

        {
          "task": {
            "entrypoint": "my-module.my_handler"
          }
        }
   Where the `entrypoint` specifies the task's handler class, identical to how it would be provided
   to AWS Lambda. If not defined, the sled will assume that `index.handler` should be used (the Lambda default).
3. Create a zip file of the task, as you ordinarily would for AWS Lambda
4. Run `npm run build` in this directory.  A minimal set of code will be produced in the `dist` directory.
5. Copy the contents of the `dist` directory (a directory named `cumulus-sled`) into the task's zip file
6. Upload the zip file to AWS Lambda, and specify the Lambda `Handler` as `cumulus-sled.handler`
7. Put it in a Cumulus workflow!
