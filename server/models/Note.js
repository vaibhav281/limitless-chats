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
                id: { type: String }, // Canonical content hash (SHA-256)
                url: { type: String }, // Relative path to file
                type: { type: String }, // 'image', 'video'
                originalMimeType: { type: String }, // Restores explicitly accurate playback after E2EE deciphering
                originalName: { type: String },
                size: { type: Number }, // File size in bytes
                encryptedBlobUrl: { type: String },
                encryptedKeys: {
                    type: Map,
                    of: new mongoose.Schema({
                        key: { type: String },
                        type: { type: Number }
                    }, { _id: false })
                },
                iv: { type: String }
            },
        ],
        senderId: { type: String, required: true },
        senderName: { type: String, default: "Anonymous" },
        receiverId: { type: String, required: true },
        // Editing functionality (Immutable Versioning)
        version: { type: Number, default: 1 }, // 🔴 CRITICAL: Architecturally mandated version lock
        isEdited: { type: Boolean, default: false },
        ciphertextEdit: { type: String, default: null },
        editType: { type: Number, default: 1 }, // Signal message type for edit ciphertext
        editedAt: { type: Date },
        editHistory: [{
            noteText: String,
            editedAt: Date
        }],
        isDeletedForEveryone: { type: Boolean, default: false },
        deletedForUsers: [{ type: String }],
        replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Note", default: null },
        isGroup: { type: Boolean, default: false },
        isRead: { type: Boolean, default: false },
        readBy: [{ type: String }],
        deliveredTo: [{ type: String }],
        status: { type: String, enum: ["sent", "delivered", "seen"], default: "sent" },
        deliveredAt: { type: Date },
        seenAt: { type: Date },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Note", noteSchema);
