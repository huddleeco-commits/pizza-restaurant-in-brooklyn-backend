const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Invalid token' });
        }

        // Preserve all user data from JWT
        req.user = {
            id: user.id,
            userId: user.id,
            email: user.email,
            is_admin: user.is_admin || false
        };
        next();
    });
}

// Admin check middleware - must be used AFTER authenticateToken
function isAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (!req.user.is_admin) {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    next();
}

module.exports = { authenticateToken, isAdmin };
