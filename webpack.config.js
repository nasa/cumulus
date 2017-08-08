const path = require('path');
const glob = require('glob');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  resolve: {
    fallback: path.join(__dirname, 'node_modules')
  },
  resolveLoader: {
    fallback: path.join(__dirname, 'node_modules')
  },
  entry: glob.sync('./cumulus/tasks/*')
             .map((filename) => {
               const entry = {};
               entry[path.basename(filename)] = filename;
               return entry;
             })
             .reduce((finalObject, entry) => Object.assign(finalObject, entry), {}),
  output: {
    path: __dirname,
    library: '[name]',
    libraryTarget: 'commonjs2',
    filename: 'cumulus/tasks/[name]/dist/index.js'
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
  //plugins: [
    //new CopyWebpackPlugin([
      //{ from: 'packages/generate-mrf/templates', to: 'generate-mrf/templates' }]
    //)
  //],
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
        include: glob.sync('./cumulus/tasks/*/index.js', { realpath: true })
                     .map((filename) => path.resolve(__dirname, filename)),
        exclude: /node_modules/,
        loader: 'prepend',
        query: {
          data: "'use strict';\nrequire('babel-polyfill');require('source-map-support').install();"
        }
      },
      {
        test: /\.js$/,
        exclude: /node_modules(?!\/@cumulus)/,
        loader: 'babel',
        query: {
          presets: [require.resolve('babel-preset-es2015')],
          plugins: [require.resolve('babel-plugin-transform-async-to-generator')]
        }
      },

      {
        test: /\.json$/,
        loader: 'json'
      }
    ]
  }
};
