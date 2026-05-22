// craco.config.js
const fs = require('fs');
const webpack = require('webpack');

const setupQueueKeypairPath = process.env.SETUP_QUEUE_KEYPAIR || '';
const setupQueueKeypairJson = (() => {
    if (!setupQueueKeypairPath) return '';

    try {
        return fs.readFileSync(setupQueueKeypairPath, 'utf8');
    } catch (error) {
        throw new Error(
            `Failed to read SETUP_QUEUE_KEYPAIR at ${setupQueueKeypairPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
})();

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
                }),
                new webpack.DefinePlugin({
                    'process.env.SETUP_MINT': JSON.stringify(process.env.SETUP_MINT || ''),
                    'process.env.SETUP_QUEUE_KEYPAIR': JSON.stringify(setupQueueKeypairPath),
                    'process.env.SETUP_QUEUE_KEYPAIR_JSON': JSON.stringify(setupQueueKeypairJson),
                })
            );

            // Ignore specific warnings (adjust the regex as needed)
            const ignoredWarnings = [/Failed to parse source map/];

            // Webpack 5 approach to use the 'ignoreWarnings' option
            webpackConfig.ignoreWarnings = webpackConfig.ignoreWarnings || [];
            webpackConfig.ignoreWarnings = [
                ...webpackConfig.ignoreWarnings,
                ...ignoredWarnings.map((pattern) => ({
                    message: pattern,
                })),
            ];

            return webpackConfig;
        },
    },
};
