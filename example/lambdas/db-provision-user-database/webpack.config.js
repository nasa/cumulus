const path = require('path');
const { IgnorePlugin } = require('webpack');

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
    new IgnorePlugin(new RegExp(`^(${ignoredPackages.join('|')})$`))
  ],
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './src/index.ts',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    // necessary for source maps to work for debugging
    devtoolModuleFilenameTemplate: '[absolute-resource-path]'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
        options: {
          // disable type checker - we will use it in fork plugin
          transpileOnly: true
        },
      },
      {
        test: /\.js$/,
        enforce: 'pre',
        use: ['source-map-loader'],
        include: /node_modules\/\@cumulus/
      },
    ],
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ],
  },
  target: 'node',
  devtool: 'source-map',
  optimization: {
    nodeEnv: false
  }
};
