const path = require('path');
const fs = require('fs');
const glob = require('glob');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  target: 'node',
  externals: [
    nodeExternals(),
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
        include: glob.sync('{./tasks/*/index.js,./services/*/index.js,**/test/**/*.js}',
                           { realpath: true })
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
