const path = require('path');

let mode = 'development';
let devtool = 'inline-source-map';

if (process.env.PRODUCTION) {
  mode = 'production';
  devtool = false;
}

module.exports = {
  mode,
  entry: './index.js',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist')
  },
  externals: [
    'aws-sdk',
    'electron',
    {
      formidable: 'url',
      sqlite3: 'sqlite3',
      mariasql: 'mariasql',
      mssql: 'mssql',
      'mssql/lib/base': 'mssql/lib/base',
      'mssql/package.json': 'mssql/package/json',
      mysql2: 'mysql2',
      tedious: 'tedious',
      oracle: 'oracle',
      'strong-oracle': 'strong-oracle',
      oracledb: 'oracledb',
      pg: 'pg',
      'pg-query-stream': 'pg-query-stream'
    }
  ],
  devtool,
  target: 'node'
};
