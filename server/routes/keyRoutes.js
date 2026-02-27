const express = require("express");
const router = express.Router();
const UserKey = require("../models/UserKey");

// @route   POST /api/v1/keys/upload
// @desc    Upload user's public identity and pre-keys
router.post("/upload", async (req, res) => {
    try {
        const { userId, registrationId, identityKey, signedPreKey, preKeys } = req.body;

        console.log("📥 RECEIVED KEY UPLOAD FOR USER:", userId);
        if (!userId || !identityKey || !signedPreKey) {
            console.error("❌ KEY UPLOAD FAILED: Missing materials.", Object.keys(req.body));
            return res.status(400).json({ error: "Missing required key materials" });
        }

        // Upsert the user's keys
        await UserKey.findOneAndUpdate(
            { userId },
            { registrationId, identityKey, signedPreKey, preKeys },
            { upsert: true, new: true }
        );

        console.log("✅ KEYS UPLOADED AND SAVED TO MONGO SUCCESSFULLY FOR:", userId);
        res.json({ success: true, message: "Keys uploaded successfully" });
    } catch (err) {
        console.error("❌ KEY UPLOAD CATCH ERROR:", err.message);
        res.status(500).json({ error: "Server error uploading keys: " + err.message });
    }
});

// @route   GET /api/v1/keys/:userId
// @desc    Fetch a user's key bundle to start a session
router.get("/:userId", async (req, res) => {
    try {
        const userKey = await UserKey.findOne({ userId: req.params.userId });
        if (!userKey) {
            return res.status(404).json({ error: "User keys not found" });
        }

        // Pop one pre-key off the array if available
        let preKey = null;
        if (userKey.preKeys && userKey.preKeys.length > 0) {
            preKey = userKey.preKeys.shift();
            await userKey.save();
        }

        res.json({
            userId: userKey.userId,
            registrationId: userKey.registrationId,
            identityKey: userKey.identityKey,
            signedPreKey: userKey.signedPreKey,
            preKey: preKey // The one-time preKey (might be null if exhausted)
        });
    } catch (err) {
        console.error("Key fetch error:", err);
        res.status(500).json({ error: "Server error fetching keys" });
    }
});

module.exports = router;
