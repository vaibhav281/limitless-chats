const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
    {
        ciphertext: { type: String, default: "" },
        iv: { type: String, default: "" },
        type: { type: Number, default: 3 }, // Signal message type (1=PreKey, 3=Ratchet)
        timestamp: { type: Date, default: Date.now },
        pinned: { type: Boolean, default: false },
        pinnedAt: { type: Date, default: null },
        attachments: [
            {
                url: { type: String }, // Relative path to file
                type: { type: String }, // 'image', 'video'
                originalName: { type: String },
                size: { type: Number }, // File size in bytes
                encryptedBlobUrl: { type: String },
                encryptedKey: { type: String },
                keyType: { type: Number },
                iv: { type: String }
            },
        ],
        senderId: { type: String, required: true },
        senderName: { type: String, default: "Anonymous" },
        receiverId: { type: String, required: true },
        isEdited: { type: Boolean, default: false },
        editedAt: { type: Date, default: null },
        isDeletedForEveryone: { type: Boolean, default: false },
        deletedForUsers: [{ type: String }],
        replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Note", default: null },
        isGroup: { type: Boolean, default: false },
        isRead: { type: Boolean, default: false },
        readBy: [{ type: String }],
        status: { type: String, enum: ["sent", "delivered", "seen"], default: "sent" },
        deliveredAt: { type: Date, default: null },
        seenAt: { type: Date, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Note", noteSchema);
