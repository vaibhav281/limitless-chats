const mongoose = require("mongoose");

const UserKeySchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        registrationId: {
            type: Number,
            required: true
        },
        identityKey: {
            type: String, // Base64 encoded public identity key
            required: true
        },
        signedPreKey: {
            keyId: { type: Number, required: true },
            publicKey: { type: String, required: true }, // Base64 encoded
            signature: { type: String, required: true }  // Base64 encoded
        },
        preKeys: [
            {
                keyId: { type: Number, required: true },
                publicKey: { type: String, required: true } // Base64 encoded
            }
        ]
    },
    { timestamps: true }
);

module.exports = mongoose.model("UserKey", UserKeySchema);
