const fs = require('fs');
const path = require('path');

const lernaInfo = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../..', 'lerna.json')
));

fs.writeFileSync(
  path.join(__dirname, '..', 'cumulus_version.json'),
  JSON.stringify({
    cumulus_version: lernaInfo.version,
  })
);
