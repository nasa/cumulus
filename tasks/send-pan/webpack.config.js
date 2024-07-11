const path = require('path');
const { IgnorePlugin } = require('webpack');
// path to module root
const root = path.resolve(__dirname);

const ignoredPackages = [
  'better-sqlite3',
  'mssql',
  'mssql/lib/base',
  'mssql/package.json',
  'mysql',
  'mysql2',
  'oracledb',
  'pg-native',
  'pg-query-stream',
  'sqlite3',
  'tedious',
];

module.exports = {
  mode: process.env.PRODUCTION ? 'production' : 'development',
  plugins: [
    new IgnorePlugin({
      resourceRegExp: new RegExp(`^(${ignoredPackages.join('|')})$`)
    }),
  ],
  entry: './dist/src/index.js',
  output: {
    chunkFormat: false,
    libraryTarget: 'commonjs2',
    path: path.resolve(__dirname, 'dist', 'webpack'),
    filename: 'index.js'
  },
  externals: [/@aws-sdk\//],
  target: 'node',
  devtool: 'eval-cheap-module-source-map',
  optimization: {
    nodeEnv: false
  },
};
