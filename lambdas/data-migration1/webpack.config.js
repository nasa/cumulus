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
  mode: process.env.PRODUCTION ? 'production' : 'development',
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
  target: 'node',
  devtool: 'inline-source-map',
  optimization: {
    nodeEnv: false
  }
};
