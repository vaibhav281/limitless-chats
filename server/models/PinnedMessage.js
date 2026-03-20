const mongoose = require("mongoose");

const pinnedMessageSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            index: true
        },
        messageId: {
            type: String,
            required: true
        },
        pinnedAt: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

// Ensure a user can only pin a specific message once
pinnedMessageSchema.index({ userId: 1, messageId: 1 }, { unique: true });

module.exports = mongoose.model("PinnedMessage", pinnedMessageSchema);
