const { auth } = require('../config/firebaseAdmin');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // Verifies the Firebase ID token
      const decodedToken = await auth.verifyIdToken(token);
      
      // Attach the decoded token (contains uid, email, etc.) to the request object
      req.user = decodedToken;
      
      next();
    } catch (error) {
      console.error('Token verification error:', error.message);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

module.exports = { protect };
