const path = require('path');
const { IgnorePlugin } = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

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
    new CopyPlugin({
      patterns: [
        {
          from: './node_modules/@cumulus/db/dist/migrations',
          to: 'migrations'
        },
      ],
    }),
  ],
  mode: 'development',
  entry: './dist/lambda/index.js',
  output: {
    chunkFormat: false,
    library: {
      type: 'commonjs2'
    },
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
      // NOTE: This is dark magic that prevents Knex from failing when
      // trying to load migration/seed files. Otherwise Webpack compilation
      // tries to treat migration/seed files as bundled assets, which they are
      // not. Thus, they need to be loaded into the runtime via `require` and not
      // `_webpack_require`.
      // see https://github.com/webpack/webpack/issues/4175#issuecomment-450746682
      {
        test: /knex\/lib\/migrations\/util\/import-file\.js$/,
        loader: 'string-replace-loader',
        options: {
          // match a require function call where the argument isn't a string
          // also capture the first character of the args so we can ignore it later
          search: 'require[(]([^\'"])',
          // replace the 'require(' with a '__non_webpack_require__(', meaning it will require the files at runtime
          // $1 grabs the first capture group from the regex, the one character we matched and don't want to lose
          replace: '__non_webpack_require__($1',
          flags: 'g'
        }
      }
    ],
  },
  // DO NOT REMOVE THIS. Otherwise __dirname in Node.js code will not behave
  // as expected
  node: {
    __dirname: false
  },
  target: 'node',
  externals: [
    /@aws-sdk\//
  ]
};
