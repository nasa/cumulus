'use strict';

const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');
// path to module root
const root = path.resolve(__dirname);

module.exports = {
  mode: process.env.PRODUCTION ? 'production' : 'development',
  entry: './index.js',
  plugins: [
    // templates to include html for readme
    new CopyPlugin({
      patterns: [
        {
          from: 'instructions',
          to: 'instructions',
        },
      ],
    }),
  ],
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    devtoolModuleFilenameTemplate: (info) => {
      const relativePath = path.relative(root, info.absoluteResourcePath);
      return `webpack://${relativePath}`;
    },
  },
  externals: [
    'aws-sdk',
    'electron',
    { formidable: 'url' },
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true,
            },
          },
        ],
      },
    ],
  },
  devtool: 'inline-source-map',
  target: 'node',
  node: {
    __dirname: false,
  },
  // https://github.com/webpack/webpack/issues/196#issuecomment-620227719
  stats: {
    warningsFilter: [
      /critical dependency:/i,
    ],
  },
  optimization: {
    nodeEnv: false,
  },
};
