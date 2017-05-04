const path = require('path');
const fs = require('fs');
const glob = require('glob');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: glob.sync('{./tasks/*,./services/*}')
             .map((filename) => {
               const entry = {};
               entry[path.basename(filename)] = filename;
               return entry;
             })
             .reduce((finalObject, entry) => Object.assign(finalObject, entry), {}),
  output: {
    path: path.join(__dirname, 'dist'),
    library: '[name]',
    libraryTarget: 'commonjs2',
    filename: '[name]/index.js'
  },
  target: 'node',
  externals: [
    'aws-sdk'
  ],
  node: {
    __dirname: false,
    __filename: false
  },
  devtool: '#inline-source-map',
  module: {
    resolve: {
      alias: {
        'aws-sdk': 'aws-sdk/dist/aws-sdk'
      }
    },
    noParse: [
      /graceful-fs\/fs.js/
    ],
    loaders: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel',
        query: JSON.parse(
          fs.readFileSync(path.join(__dirname, '.babelrc'), { encoding: 'utf8' })
        )
      },
      {
        include: glob.sync('{./tasks/*/index.js,./services/*/index.js}', { realpath: true })
                     .map((filename) => path.resolve(__dirname, filename)),
        exclude: /node_modules/,
        loader: 'prepend',
        query: {
          data: "'use strict';\nrequire('babel-polyfill');require('source-map-support').install();"
        }
      },
      {
        test: /\.json$/,
        loader: 'json'
      }
    ]
  }
};
