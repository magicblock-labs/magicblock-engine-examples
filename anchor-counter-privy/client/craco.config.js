// craco.config.js
const webpack = require('webpack');

/**
 * Walk all webpack rules (including nested oneOf arrays) and call `fn` on every
 * object that has a `loader` string containing "babel-loader".
 */
const forEachBabelLoader = (rules, fn) => {
    for (const rule of rules) {
        if (!rule) continue;
        if (rule.oneOf) forEachBabelLoader(rule.oneOf, fn);
        if (typeof rule.loader === 'string' && rule.loader.includes('babel-loader')) fn(rule);
        const uses = Array.isArray(rule.use) ? rule.use : rule.use ? [rule.use] : [];
        for (const u of uses) {
            if (u && typeof u.loader === 'string' && u.loader.includes('babel-loader')) fn(u);
        }
    }
};

module.exports = {
    webpack: {
        configure: (webpackConfig) => {
            // Specify fallbacks for Node.js modules that are not available in the browser
            webpackConfig.resolve.fallback = {
                http: require.resolve('stream-http'),
                https: require.resolve('https-browserify'),
                crypto: require.resolve('crypto-browserify'),
                stream: require.resolve('stream-browserify'),
                buffer: require.resolve('buffer-browserify'),
                zlib: false,
                url: false,
                vm: false,
            };

            webpackConfig.output = {
                ...webpackConfig.output,
                publicPath: '/',
            };

            // Add Buffer global if it's missing
            webpackConfig.plugins = (webpackConfig.plugins || []).concat(
                new webpack.ProvidePlugin({
                    Buffer: ['buffer', 'Buffer'],
                })
            );

            // Ignore specific warnings (adjust the regex as needed)
            const ignoredWarnings = [/Failed to parse source map/];

            webpackConfig.ignoreWarnings = webpackConfig.ignoreWarnings || [];
            webpackConfig.ignoreWarnings = [
                ...webpackConfig.ignoreWarnings,
                ...ignoredWarnings.map((pattern) => ({
                    message: pattern,
                })),
            ];

            // @base-org/account ships with `import ... with { type: 'json' }` (import
            // attributes), which is not yet enabled in CRA's Babel parser. Add the
            // syntax plugin to every babel-loader instance so it can be parsed.
            forEachBabelLoader(webpackConfig.module.rules, (loaderConfig) => {
                if (!loaderConfig.options) return;
                loaderConfig.options = {
                    ...loaderConfig.options,
                    plugins: [
                        ...(loaderConfig.options.plugins || []),
                        require.resolve('@babel/plugin-syntax-import-attributes'),
                    ],
                };
            });

            return webpackConfig;
        },
    },
};
