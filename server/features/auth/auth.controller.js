const AuthService = require("./auth.service");

class AuthController {
    async register(req, res) {
        try {
            const { username, email, password, authProvider } = req.body;

            if (!username || !email) {
                return res.status(400).json({ message: "Username and email are required" });
            }

            const user = await AuthService.registerUser({ username, email, password, authProvider });

            // Do not send token yet; client must upload keys first to be fully active.
            // But we will send the user info so the client can initialize the E2EE keys.
            res.status(201).json({
                message: "User created successfully. Awaiting E2EE key registration.",
                user: {
                    _id: user._id,
                    username: user.username,
                    email: user.email
                }
            });
        } catch (error) {
            if (error.message.includes("already exists")) {
                return res.status(409).json({ message: error.message });
            }
            res.status(500).json({ message: error.message || "Server Error during registration" });
        }
    }

    async login(req, res) {
        try {
            const { email, password, authProvider } = req.body;

            if (!email) {
                return res.status(400).json({ message: "Email is required" });
            }

            const user = await AuthService.loginUser({ email, password, authProvider });
            const token = AuthService.generateToken(user);

            res.status(200).json({
                message: "Login successful",
                token,
                user: {
                    _id: user._id,
                    username: user.username,
                    email: user.email
                }
            });
        } catch (error) {
            res.status(401).json({ message: error.message || "Invalid credentials" });
        }
    }

    async generateTokenForRegisteredUser(req, res) {
        // Called AFTER the keys are generated and uploaded successfully.
        try {
            const { userId } = req.body;
            const User = require("../../models/User");
            const user = await User.findById(userId);
            if (!user) return res.status(404).json({ message: "User not found" });

            const token = AuthService.generateToken(user);
            res.status(200).json({ token });
        } catch (err) {
            res.status(500).json({ message: "Server error generating token" });
        }
    }
}

module.exports = new AuthController();
