/**
 * Cloudinary Service Stub
 */

const cloudinary = require('cloudinary').v2;

// Configure if env vars exist
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

module.exports = {
  uploadImage: async (imagePath, options = {}) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      console.log('☁️ Cloudinary not configured - using stub');
      return { secure_url: 'https://via.placeholder.com/300', public_id: 'stub_' + Date.now() };
    }
    return await cloudinary.uploader.upload(imagePath, options);
  },
  deleteImage: async (publicId) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME) return { result: 'ok' };
    return await cloudinary.uploader.destroy(publicId);
  }
};
