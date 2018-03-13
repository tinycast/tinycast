const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  name: 'tinycast',
  entry: {
    index: './src/index.jsx',
  },
  output: {
    path: path.join(__dirname, 'dist'),
    filename: 's/[name].[chunkhash].js',
    publicPath: '/',
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.svg$/,
        loader: '@svgr/webpack',
        options: {
          replaceAttrValues: {
            '#333': 'currentColor',
            '#555': '{props.color}',
          },
        },
      },
      {
        test: /\.woff$/,
        loader: 'file-loader',
        options: {
          name: 's/[name].[hash].[ext]',
        },
      },
    ],
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: 'src/index.ejs',
    }),
  ],
  devServer: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.SERVER_PORT}`,
        pathRewrite: {'^/api' : ''},
        ws: true,
      },
    },
  },
}
