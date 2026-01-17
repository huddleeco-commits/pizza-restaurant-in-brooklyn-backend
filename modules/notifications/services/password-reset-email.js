/**
 * Password Reset Email Stub
 */

module.exports = {
  sendPasswordResetEmail: async (email, resetToken) => {
    console.log('📧 Password reset email (stub) to:', email);
    return { success: true, messageId: 'stub_' + Date.now() };
  }
};
