const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },
        passwordHash: {
            type: String,
            // Not required because if they use Firebase/Google auth later, they won't have a local password
        },
        authProvider: {
            type: String,
            enum: ["local", "firebase"],
            default: "local"
        },
        providerId: {
            type: String,
            // For future Firebase User UID mapping
        },
        loginAttempts: {
            type: Number,
            default: 0
        },
        lockUntil: {
            type: Date
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
