const path = require('path');
const { IgnorePlugin } = require('webpack');

// path to module root
const root = path.resolve(__dirname);

const ignoredPackages = [
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
    new IgnorePlugin(new RegExp(`^(${ignoredPackages.join('|')})$`)),
  ],
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './src/index.ts',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    devtoolModuleFilenameTemplate: (info) => {
      const relativePath = path.relative(root, info.absoluteResourcePath)
      return `webpack://${relativePath}`;
    }
  },
  externals: [
    'aws-sdk',
    'electron',
    {'formidable': 'url'}
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ],
  },
  devtool: 'inline-source-map',
  target: 'node',
  optimization: {
    nodeEnv: false
  }
};
