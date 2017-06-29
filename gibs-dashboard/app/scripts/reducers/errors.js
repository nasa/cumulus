
const { List } = require('immutable');

// Actions
const ERROR = 'ERROR';

const reducer = (state = List(), action) => {
  switch (action.type) {
    case ERROR:
      return state.push(action.error);
    default:
      return state;
  }
};

const errorAction = message => ({
  type: ERROR,
  error: message
});

module.exports = {
  reducer,
  errorAction
};
