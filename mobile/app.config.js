const DEFAULT_ANDROID_ARCHS = [
  'armeabi-v7a',
  'arm64-v8a',
  'x86',
  'x86_64',
];

module.exports = ({ config }) => {
  const buildArchs = process.env.ANDROID_ARCHS
    ? process.env.ANDROID_ARCHS.split(',').map((value) => value.trim()).filter(Boolean)
    : DEFAULT_ANDROID_ARCHS;

  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      [
        './plugins/withAndroidArchitectures',
        { buildArchs },
      ],
    ],
  };
};
