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
            
            // Password complexity validation
            if (password.length < 8) {
                throw new Error("Password must be at least 8 characters long");
            }
            
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

            // Check if account is locked
            if (user.lockUntil && user.lockUntil > Date.now()) {
                const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
                throw new Error(`Account temporarily locked. Try again in ${minutesLeft} minutes.`);
            }

            const isMatch = await bcrypt.compare(password, user.passwordHash);
            if (!isMatch) {
                // Increment login attempts
                user.loginAttempts += 1;
                if (user.loginAttempts >= 5) {
                    user.lockUntil = Date.now() + 30 * 60000; // Lock for 30 minutes
                }
                await user.save();
                throw new Error("Invalid credentials");
            }

            // Reset login attempts on successful login
            if (user.loginAttempts > 0 || user.lockUntil) {
                user.loginAttempts = 0;
                user.lockUntil = undefined;
                await user.save();
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
