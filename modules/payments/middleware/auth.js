/**
 * Auth Middleware
 * Auto-generated - exports all common naming patterns
 */

const jwt = require('jsonwebtoken');

// Main authentication function
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'dev-secret', (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }
    req.user = {
      id: user.id,
      userId: user.id,
      email: user.email,
      is_admin: user.is_admin || false
    };
    next();
  });
}

// Admin check middleware
function isAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// Export ALL common naming patterns
module.exports = {
  // Common names used across different modules
  authenticateToken,
  authenticate: authenticateToken,
  auth: authenticateToken,
  verifyToken: authenticateToken,
  requireAuth: authenticateToken,
  protect: authenticateToken,
  
  // Admin middleware
  isAdmin,
  adminOnly: isAdmin,
  requireAdmin: isAdmin
};
