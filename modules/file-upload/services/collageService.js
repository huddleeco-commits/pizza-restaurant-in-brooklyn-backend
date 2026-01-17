/**
 * Collage Service Stub
 */

module.exports = {
  generateLotCollages: async (images, options = {}) => {
    console.log('🖼️ Generating collage (stub)');
    return { url: 'https://via.placeholder.com/800x600', images: images.length };
  },
  createCollage: async (imageUrls) => {
    return 'https://via.placeholder.com/800x600';
  }
};
