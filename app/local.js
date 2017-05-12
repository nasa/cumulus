'use strict';

// Allows running the app locally.

const app = require('./app')();
const port = process.env.PORT || 3000;
app.listen(port);

/*eslint no-console: ["error", { allow: ["log"] }]*/
console.log(`Listening on port ${port}`);
