# moon demo

-- Start test services
npm run start-unit-test-stack

moon check --all
moon project-graph
moon project aws-client
moon ci

-- Edit one package, incremental rebuild only dependents
v packages/errors/src/index.ts 
moon ci    


