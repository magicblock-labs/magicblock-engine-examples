// craco.config.js
const webpack = require("webpack");

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Specify fallbacks for Node.js modules that are not available in the browser
      webpackConfig.resolve.fallback = {
        http: require.resolve("stream-http"),
        https: require.resolve("https-browserify"),
        crypto: require.resolve("crypto-browserify"),
        stream: require.resolve("stream-browserify"),
        buffer: require.resolve("buffer-browserify"),
        zlib: false,
        url: false,
        vm: false,
      };

      webpackConfig.output = {
        ...webpackConfig.output,
        publicPath: "/",
      };

      // Add Buffer global if it's missing
      webpackConfig.plugins = (webpackConfig.plugins || []).concat(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
        }),
      );

      // Ignore specific warnings (adjust the regex as needed)
      const ignoredWarnings = [
        /Failed to parse source map/,
        // Transitive dynamic require() calls from @protobufjs/inquire and
        // ox's tempo internals — both intentional and benign in browser builds.
        /Critical dependency: the request of a dependency is an expression/,
      ];

      // Webpack 5 approach to use the 'ignoreWarnings' option
      webpackConfig.ignoreWarnings = webpackConfig.ignoreWarnings || [];
      webpackConfig.ignoreWarnings = [
        ...webpackConfig.ignoreWarnings,
        ...ignoredWarnings.map((pattern) => ({
          message: pattern,
        })),
      ];

      // Silence Dart Sass's "legacy JS API is deprecated" log emitted while
      // CRA's older sass-loader compiles .scss. The legacy API still works;
      // this just hides the noise until CRA upgrades sass-loader.
      const silenceSassDeprecation = (rules) => {
        if (!Array.isArray(rules)) return;
        for (const rule of rules) {
          if (rule && Array.isArray(rule.oneOf))
            silenceSassDeprecation(rule.oneOf);
          if (rule && Array.isArray(rule.use)) {
            for (const u of rule.use) {
              if (
                typeof u === "object" &&
                u.loader &&
                u.loader.includes("sass-loader")
              ) {
                u.options = u.options || {};
                u.options.sassOptions = u.options.sassOptions || {};
                u.options.sassOptions.silenceDeprecations = [
                  ...(u.options.sassOptions.silenceDeprecations || []),
                  "legacy-js-api",
                ];
              }
            }
          }
        }
      };
      silenceSassDeprecation(
        webpackConfig.module && webpackConfig.module.rules,
      );

      return webpackConfig;
    },
  },
};
