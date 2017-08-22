const path = require('path');
const glob = require('glob');
const fs = require('fs');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  resolve: {
    fallback: path.join(__dirname, 'node_modules')
  },
  resolveLoader: {
    fallback: path.join(__dirname, 'node_modules')
  },
  entry: glob.sync('./{tasks,services}/*/package.json')
             .map((packageJson) => {
               const filename = path.dirname(packageJson);
               const entry = {};
               if (!fs.existsSync(path.join(filename, 'webpack.config.js'))) {
                 entry[path.basename(filename)] = filename;
               }
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
    'aws-sdk',
    'electron'
  ],
  node: {
    __dirname: false,
    __filename: false
  },
  devtool: '#inline-source-map',
  plugins: [
    new CopyWebpackPlugin([
      { from: 'tasks/generate-mrf/templates', to: 'generate-mrf/templates' }]
    )
  ],
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
        exclude: /node_modules(?!\/cumulus-)/,
        loader: 'babel',
        query: {
          presets: [require.resolve('babel-preset-es2015')],
          plugins: [require.resolve('babel-plugin-transform-async-to-generator')]
        }
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
