// ✔ ~/DevSeed/cumulus-projects/cumulus/packages/api
// $ nvm use 8.0
// $ node

var bootstrap = require('./lambdas/bootstrap')
bootstrap.bootstrapElasticSearch('http://localhost:4571')
