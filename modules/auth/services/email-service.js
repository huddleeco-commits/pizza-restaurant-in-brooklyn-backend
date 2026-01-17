/**
 * Email Service Stub
 * Replace with actual email provider (SendGrid, AWS SES, etc.)
 */

module.exports = {
  sendEmail: async ({ to, subject, html, text }) => {
    console.log('📧 Email stub - would send to:', to);
    console.log('   Subject:', subject);
    // In production, integrate with SendGrid, AWS SES, etc.
    return { success: true, messageId: 'stub_' + Date.now() };
  },
  
  sendWelcomeEmail: async (email, name) => {
    return module.exports.sendEmail({
      to: email,
      subject: 'Welcome!',
      html: `<h1>Welcome ${name}!</h1>`
    });
  },
  
  sendPasswordReset: async (email, resetToken) => {
    return module.exports.sendEmail({
      to: email,
      subject: 'Password Reset',
      html: `<p>Reset your password with token: ${resetToken}</p>`
    });
  }
};
