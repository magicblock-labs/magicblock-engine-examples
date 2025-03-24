const path = require("path");
const webpack = require("webpack");
const HTMLWebpackPlugin = require("html-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

module.exports = (env, argv) => {
  let isDevelopment = (process.env.NODE_ENV = argv["mode"]) !== "production";

  return {
    entry: "./src/index.tsx",

    mode: isDevelopment ? "development" : "production",

    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[contenthash].[name].js",
    },

    resolve: {
      modules: ["node_modules"],
      // Add '.ts' and '.tsx' as resolvable extensions.
      extensions: [".json", ".js", ".ts", ".tsx", ".js", ".css", ".scss"],
    },

    devServer: {
      static: {
        directory: path.join(__dirname, "dist/"),
      },
    },

    module: {
      rules: [
        {
          test: /\.ts(x?)$/,
          exclude: /node_modules/,
          use: [{ loader: "ts-loader" }],
        },
        {
          test: /\.scss$/,
          use: ["style-loader", "css-loader", "sass-loader"],
        },
        {
          test: /\.(png|jpe?g|gif|svg)$/,
          use: ["file-loader"],
        },
      ],
    },

    plugins: [
      new CleanWebpackPlugin(),
      new HTMLWebpackPlugin({
        template: path.join(__dirname, "./src/index.html"),
      }),
      // Shims necessary
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
        process: "process/browser",
      }),
    ],
  };
};
