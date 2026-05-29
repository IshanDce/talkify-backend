const ImageKit = require('imagekit');
const config = require('./index');

let imagekitInstance = null;

const getImageKit = () => {
  if (imagekitInstance) return imagekitInstance;

  if (!config.imagekit.publicKey || !config.imagekit.privateKey || !config.imagekit.urlEndpoint) {
    console.warn('[ImageKit] ImageKit credentials not configured. Media uploads disabled.');
    return null;
  }

  imagekitInstance = new ImageKit({
    publicKey: config.imagekit.publicKey,
    privateKey: config.imagekit.privateKey,
    urlEndpoint: config.imagekit.urlEndpoint,
  });

  console.log('[ImageKit] ImageKit SDK initialized');
  return imagekitInstance;
};

module.exports = { getImageKit };