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
  mode: 'development',
  entry: './dist/lambda/index.js',
  output: {
    libraryTarget: 'commonjs2',
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
      {
        test: /knex\/lib\/util\/import-file\.js$/,
        loader: 'string-replace-loader',
        options: {
          search: 'require(\\([^\'"])',
          replace: '__non_webpack_require__$1',
          flags: 'g'
        }
      }
    ],
  },
  node: {
    __dirname: false
  },
  target: 'node'
};
