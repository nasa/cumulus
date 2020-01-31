const awsServices = require('./services');

exports.putEvent = (name, schedule, state, description = null, role = null) => {
  const params = {
    Name: name,
    Description: description,
    RoleArn: role,
    ScheduleExpression: schedule,
    State: state
  };

  return awsServices.cloudwatchevents().putRule(params).promise();
};

exports.deleteEvent = (name) => {
  const params = {
    Name: name
  };

  return awsServices.cloudwatchevents().deleteRule(params).promise();
};

exports.deleteTarget = (id, rule) => {
  const params = {
    Ids: [id],
    Rule: rule
  };

  return awsServices.cloudwatchevents().removeTargets(params).promise();
};

exports.putTarget = (rule, id, arn, input) => {
  const params = {
    Rule: rule,
    Targets: [ /* required */
      {
        Arn: arn,
        Id: id,
        Input: input
      }
    ]
  };

  return awsServices.cloudwatchevents().putTargets(params).promise();
};
