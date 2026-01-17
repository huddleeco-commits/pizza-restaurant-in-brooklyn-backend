const sharp = require('sharp');
const axios = require('axios');

class ImageProcessor {
  /**
   * Crop grading label from slab image
   * Removes top 25% to eliminate PSA/BGS label
   */
  async cropLabel(imageUrl, gradingCompany) {
    try {
      console.log(`✂️ Cropping label from ${gradingCompany} slab...`);
      
      // Fetch image
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      
      const metadata = await sharp(buffer).metadata();
      const { width, height } = metadata;
      
      console.log(`📐 Original: ${width}x${height}`);
      
      // Universal crop: Remove top 25%, take center 70%
      const cropParams = {
        left: Math.floor(width * 0.15),
        top: Math.floor(height * 0.25),
        width: Math.floor(width * 0.70),
        height: Math.floor(height * 0.70)
      };
      
      const croppedBuffer = await sharp(buffer)
        .extract(cropParams)
        .jpeg({ quality: 90 })
        .toBuffer();
      
      const base64 = croppedBuffer.toString('base64');
      console.log(`✅ Cropped to ${cropParams.width}x${cropParams.height}`);
      
      return base64;
      
    } catch (error) {
      console.error('❌ Crop error:', error.message);
      // Return null on error - caller will use original image
      return null;
    }
  }
}

module.exports = new ImageProcessor();