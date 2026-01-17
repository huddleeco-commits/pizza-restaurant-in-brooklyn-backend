/**
 * Claude Scanner Stub
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

module.exports = {
  scanCard: async (imageBase64) => {
    if (!client) {
      console.log('🤖 Claude scanner not configured - using stub');
      return { success: false, error: 'API key not configured' };
    }
    // Real implementation would call Claude API
    return { success: true, data: {} };
  },
  analyzeImage: async (imageBuffer) => {
    console.log('🔍 Analyzing image (stub)');
    return { cardName: 'Unknown', set: 'Unknown', condition: 'Unknown' };
  }
};
