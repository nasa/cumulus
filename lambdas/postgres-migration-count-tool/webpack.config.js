const path = require('path');
const { IgnorePlugin } = require('webpack');

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
  'tedious'
];

module.exports = {
  plugins: [
    new IgnorePlugin({
      resourceRegExp: new RegExp(`^(${ignoredPackages.join('|')})$`)
    }),
  ],
  mode: 'development',
  entry: './dist/lambda/index.js',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist', 'webpack')
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true
            },
          },
        ],
      },
    ],
  },
  // DO NOT REMOVE THIS. Otherwise __dirname in Node.js code will not behave
  // as expected
  node: {
    __dirname: false
  },
  target: 'node'
};
