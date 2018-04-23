const path = require('path');
const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

let mode = 'development';
let devtool = 'inline-source-map';

if (process.env.PRODUCTION) {
   mode = 'production';
   devtool = false;
}

module.exports = {
  mode,
  entry: './index.js',
  output: {
    libraryTarget: 'commonjs2',
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist')
  },
  externals: [
    'aws-sdk',
    'electron'
  ],
  devtool,
  target: 'node',
  optimization: {
    minimizer: [
      new UglifyJsPlugin({
        parallel: true,  // Webpack default
        cache: true ,     // Webpack default
                    uglifyOptions: {
          /*
              inlining is broken sometimes where inlined function uses the same variable name as inlining function.
              See https://github.com/mishoo/UglifyJS2/issues/2842, https://github.com/mishoo/UglifyJS2/issues/2843
              and https://github.com/webpack-contrib/uglifyjs-webpack-plugin/issues/264
           */
          compress: { inline: false },
        },
      })
    ],
  }
};