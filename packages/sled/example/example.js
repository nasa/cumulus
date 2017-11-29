exports.handler = function handler(event, context, callback) {
  console.log('Hello, example!');
  console.log('Nested Event:', event);
  console.log('Nested Context:', context);
  callback(null, event);
};