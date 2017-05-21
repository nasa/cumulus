'use strict';

const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    lambda: ['babel-polyfill', './app/lambda.js'],
    local: ['babel-polyfill', './app/local.js'],
    indexer: ['babel-polyfill', './app/execution-indexer.js']
  },
  target: 'node',
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    library: '[name]',
    libraryTarget: 'commonjs2'
  },
  plugins: [new CopyWebpackPlugin([
    {
      from: 'app/views',
      to: 'views'
    }, {
      from: 'public',
      to: 'public'
    }
  ])],
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            cacheDirectory: true,
            presets: [require.resolve('babel-preset-env')]
          }
        }
      }, {
        test: /\.html$/,
        use: [
          {
            loader: 'html-loader',
            options: {
              interpolate: true
            }
          }
        ]
      }, {
        test: /\.md$/,
        use: [
          {
            loader: 'html-loader'
          }, {
            loader: 'markdown-loader',
            options: {
              /* your options here */
            }
          }
        ]
      }
    ]
  }
};
