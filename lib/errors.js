const createErrorType = (name) => {
  function E(message) {
    Error.captureStackTrace(this, this.constructor);
    this.message = message;
  }
  E.prototype = new Error();
  E.prototype.name = name;
  E.prototype.constructor = E;
  return E;
};

module.exports = {
  NotNeededError: createErrorType('NotNeeded'),
  IncompleteError: createErrorType('Incomplete')
};
