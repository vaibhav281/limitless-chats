const jwt = require("jsonwebtoken");

const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Authentication token missing or invalid" });
    }

    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_jwt_secret_dev_only");
        req.user = decoded; // { userId, username, email }
        next();
    } catch (err) {
        return res.status(401).json({ message: "Token is invalid or expired" });
    }
};

module.exports = { requireAuth };
