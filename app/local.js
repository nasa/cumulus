'use strict';

// Allows running the app locally.

const app = require('./app')();
app.listen(3000);

/*eslint no-console: ["error", { allow: ["log"] }]*/
console.log('Listening on port 3000');

