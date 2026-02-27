const User = require("../../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

class AuthService {
    async registerUser({ username, email, password, authProvider = "local" }) {
        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            throw new Error("User with this email already exists");
        }

        let passwordHash = null;
        if (authProvider === "local") {
            if (!password) throw new Error("Password is required for local authentication");
            // Hash password
            const salt = await bcrypt.genSalt(10);
            passwordHash = await bcrypt.hash(password, salt);
        }

        // Create user
        const newUser = new User({
            username,
            email,
            passwordHash,
            authProvider
        });

        await newUser.save();
        return newUser;
    }

    async loginUser({ email, password, authProvider = "local" }) {
        const user = await User.findOne({ email });
        if (!user) {
            throw new Error("Invalid credentials");
        }

        if (authProvider === "local") {
            if (user.authProvider !== "local") {
                throw new Error(`This account uses ${user.authProvider} login.`);
            }

            const isMatch = await bcrypt.compare(password, user.passwordHash);
            if (!isMatch) {
                throw new Error("Invalid credentials");
            }
        }

        return user;
    }

    generateToken(user) {
        const payload = {
            userId: user._id,
            username: user.username,
            email: user.email
        };

        // Keep token short-lived for security
        return jwt.sign(payload, process.env.JWT_SECRET || "default_jwt_secret_dev_only", {
            expiresIn: "7d" // Could be shorter, but 7d is fine for now
        });
    }
}

module.exports = new AuthService();
