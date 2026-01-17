const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

async function uploadImage(base64Image, cardId, userId, type = 'front') {
  try {
    // Determine environment - use 'staging' if NODE_ENV is not 'production'
    const environment = process.env.NODE_ENV === 'production' ? 'production' : 'staging';
    const folderPath = `slabtrack/${environment}/users/${userId}/cards`;
    
    console.log('📂 CLOUDINARY UPLOAD - userId:', userId, 'cardId:', cardId, 'type:', type);
    console.log('📂 FOLDER PATH:', folderPath);
    
    const result = await cloudinary.uploader.upload(base64Image, {
      folder: folderPath,
      public_id: `card_${cardId}_${type}`,
      overwrite: true,
      resource_type: 'auto',
      invalidate: true, // Force CDN cache refresh
      context: {
        user_id: userId.toString(),
        card_id: cardId,
        type: type
      }
    });
    
    console.log('✅ Successfully uploaded to Cloudinary:', result.secure_url);
    return result.secure_url;
  } catch (error) {
    console.error('❌ Cloudinary upload error:', error);
    // Return placeholder instead of throwing to prevent scan failure
    console.log('⚠️ Returning placeholder due to upload failure');
    return `https://via.placeholder.com/300?text=${type}`;
  }
}

// Helper function to delete user's card images
async function deleteCardImages(cardId, userId) {
  try {
    const environment = process.env.NODE_ENV === 'production' ? 'production' : 'staging';
    const folderPath = `slabtrack/${environment}/users/${userId}/cards`;
    
    await cloudinary.api.delete_resources([
      `${folderPath}/card_${cardId}_front`,
      `${folderPath}/card_${cardId}_back`
    ]);
    
    console.log('🗑️ Deleted images for card:', cardId);
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    // Don't throw - deletion failure shouldn't break the app
  }
}

// Helper function to delete all images for a user (for account deletion)
async function deleteUserImages(userId) {
  try {
    const environment = process.env.NODE_ENV === 'production' ? 'production' : 'staging';
    await cloudinary.api.delete_resources_by_prefix(
      `slabtrack/${environment}/users/${userId}/`
    );
    console.log('🗑️ Deleted all images for user:', userId);
  } catch (error) {
    console.error('Cloudinary bulk delete error:', error);
  }
}

// Upload social media post image
async function uploadSocialImage(base64Image, auctionId, userId, postType = 'listing') {
  try {
    const environment = process.env.NODE_ENV === 'production' ? 'production' : 'staging';
    const folderPath = `slabtrack/${environment}/users/${userId}/social`;
    const timestamp = Date.now();
    
    console.log('📱 SOCIAL IMAGE UPLOAD - userId:', userId, 'auctionId:', auctionId, 'type:', postType);
    
    const result = await cloudinary.uploader.upload(base64Image, {
      folder: folderPath,
      public_id: `auction_${auctionId}_${postType}_${timestamp}`,
      overwrite: false,
      resource_type: 'image',
      context: {
        user_id: userId.toString(),
        auction_id: auctionId.toString(),
        post_type: postType
      }
    });
    
    console.log('✅ Social image uploaded:', result.secure_url);
    return {
      url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height
    };
  } catch (error) {
    console.error('❌ Social image upload error:', error);
    throw error;
  }
}

// Delete social images for an auction
async function deleteSocialImages(auctionId, userId) {
  try {
    const environment = process.env.NODE_ENV === 'production' ? 'production' : 'staging';
    const folderPath = `slabtrack/${environment}/users/${userId}/social`;
    
    await cloudinary.api.delete_resources_by_prefix(`${folderPath}/auction_${auctionId}_`);
    console.log('🗑️ Deleted social images for auction:', auctionId);
  } catch (error) {
    console.error('Social image delete error:', error);
  }
}

module.exports = { uploadImage, deleteCardImages, deleteUserImages, uploadSocialImage, deleteSocialImages, cloudinary };