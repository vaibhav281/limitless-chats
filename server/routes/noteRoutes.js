const express = require("express");
const router = express.Router();
const Note = require("../models/Note");

const upload = require("../middleware/upload");

// @route   POST /api/v1/notes
router.post("/", (req, res, next) => {
  upload.array("files")(req, res, function (err) {
    if (err) {
      console.error("Multer Error:", err.message);
      return res.status(400).json({ message: err.message || "Unsupported file upload error" });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { ciphertext, type: messageType, replyTo, senderName, senderId, receiverId, isGroup } = req.body;

    if (!senderId || !receiverId) {
      return res.status(400).json({ message: "senderId and receiverId are required." });
    }

    let attachments = [];

    if (req.files && req.files.length > 0) {
      let metaData = [];
      try {
        metaData = JSON.parse(req.body.attachmentsMeta || "[]");
      } catch (e) {
        console.warn("Could not parse attachmentsMeta JSON array", e);
      }

      attachments = req.files.map((file, i) => {
        const meta = metaData[i] || {};
        const mime = file.mimetype;
        const ext = file.originalname.split('.').pop().toLowerCase();
        let type = meta.type || "other";

        if (!meta.type) {
          if (mime.startsWith("image")) type = "image";
          else if (mime.startsWith("video")) type = "video";
          else if (mime.startsWith("audio")) type = "audio";
          else if (["pdf", "doc", "docx", "txt", "xls", "xlsx", "ppt", "pptx"].includes(ext)) type = "document";
          else if (["zip", "rar", "7z", "tar"].includes(ext)) type = "archive";
        }

        return {
          id: meta.id, // Canonical content hash
          fileName: meta.fileName || file.originalname, // The original readable name 
          url: `/uploads/${file.filename}`, // The server path to the ciphertext blob
          encryptedBlobUrl: `/uploads/${file.filename}`,
          type,
          originalMimeType: meta.originalMimeType || mime,
          // CRITICAL FIX: The frontend specifically expects `originalName` to trigger valid downloads
          // Previously this captured the hash.enc name from multer
          originalName: meta.fileName || file.originalname,
          size: file.size,
          encryptedKeys: meta.encryptedKeysMap || {},
          iv: meta.iv
        };
      });
    }

    const note = await Note.create({
      ciphertext,
      type: messageType || 3,
      attachments,
      replyTo: replyTo || null,
      senderId,
      receiverId,
      isGroup: isGroup || receiverId === 'global_group',
      senderName: senderName || "Anonymous"
    });

    // Fetch newly created note with populated replyTo
    const populatedNote = await Note.findById(note._id).populate("replyTo");

    if (req.io && req.userSockets) {
      if (receiverId === "global_group") {
        // Broadcast to everyone
        req.io.emit("newNote", populatedNote);
      } else {
        const receiverSocketId = req.userSockets.get(receiverId);
        if (receiverSocketId) {
          req.io.to(receiverSocketId).emit("newNote", populatedNote);
        }

        // Also emit back to sender in case they have another tab open syncing the app state
        const senderSocketId = req.userSockets.get(senderId);
        if (senderSocketId && senderSocketId !== receiverSocketId) {
          req.io.to(senderSocketId).emit("newNote", populatedNote);
        }
      }
    }

    res.status(201).json(populatedNote);
  } catch (error) {
    res.status(500).json({ message: "Error saving note", error });
  }
});


// @route   GET /api/v1/notes
router.get("/", async (req, res) => {
  try {
    const { userId, chatWithId, limit = 20, before } = req.query;

    let filter = {};
    if (userId && chatWithId) {
      if (chatWithId === "global_group") {
        filter = { receiverId: "global_group" };
      } else {
        filter = {
          $or: [
            { senderId: userId, receiverId: chatWithId },
            { senderId: chatWithId, receiverId: userId }
          ]
        };
      }
    }

    if (before && before !== "undefined") {
      filter.timestamp = { $lt: new Date(before) };
    }

    if (userId) {
      // We intentionally let them pass the filter now so we can return tombstones!
    }

    const notes = await Note.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .populate("replyTo");

    // Securely sanitize private deletes into tombstones before leaving the server
    const sanitizedNotes = notes.map(note => {
      const isDeletedForMe = userId && note.deletedForUsers && note.deletedForUsers.includes(userId);
      if (isDeletedForMe) {
        return {
          ...note.toObject(),
          noteText: "",
          attachments: [],
          isDeletedForMe: true
        };
      }
      return note;
    });

    res.json(sanitizedNotes);
  } catch (error) {
    res.status(500).json({ message: "Error fetching notes", error });
  }
});

// Delete single note (Advanced WhatsApp Logic)
router.delete("/:id", async (req, res) => {
  try {
    const { userId, deleteType } = req.query; // 'for_me' or 'for_everyone'
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    // Validate 24-hour rule for "Delete for everyone"
    if (deleteType === 'for_everyone') {
      if (note.senderId !== userId) return res.status(403).json({ error: "Unauthorized to delete for everyone." });
      const ageInMs = Date.now() - new Date(note.timestamp).getTime();
      if (ageInMs > 86400000) { // 24 hours in ms
        return res.status(403).json({ error: "Message is too old to be deleted for everyone." });
      }

      // Soft delete: wipe text, drop attachments, flag as deleted
      note.isDeletedForEveryone = true;
      note.noteText = "";
      note.attachments = [];
      await note.save();

      const populatedNote = await Note.findById(note._id).populate("replyTo");
      if (req.io) req.io.emit("noteUpdated", populatedNote);
      return res.json({ success: true, note: populatedNote });
    }

    // Default to 'for_me'
    if (!note.deletedForUsers.includes(userId)) {
      note.deletedForUsers.push(userId);
      await note.save();
    }

    // We do NOT emit anything globally for 'for_me', as it's private.
    // The client triggering this will just optimistically remove it locally.
    res.json({ success: true, forMeOnly: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete multiple notes (Advanced WhatsApp Logic)
router.post("/delete-multiple", async (req, res) => {
  try {
    const { ids, userId, deleteType } = req.body;

    // We only support 'for_me' currently on bulk delete in WhatsApp 
    // unless they strictly enforce the 24h & ownership rule on every bulk item. 
    // For safety, bulk delete maps to 'for_me'.

    await Note.updateMany(
      { _id: { $in: ids } },
      { $addToSet: { deletedForUsers: userId } }
    );

    res.json({ success: true, forMeOnly: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark messages as read
router.put("/mark-read", async (req, res) => {
  try {
    const { senderId, receiverId, isGroup } = req.body;

    if (isGroup || senderId === 'global_group') {
      // For groups, push the receiverId into the 'readBy' array
      await Note.updateMany(
        { receiverId: senderId, readBy: { $ne: receiverId } },
        { $push: { readBy: receiverId } }
      );
    } else {
      const seenAt = new Date();

      const unreadNotes = await Note.find({ senderId, receiverId, isRead: { $ne: true } });
      const messageIds = unreadNotes.map(n => n._id);

      // For private DMs, set isRead true and seen status
      await Note.updateMany(
        { senderId, receiverId, isRead: { $ne: true } },
        { $set: { isRead: true, status: 'seen', seenAt } }
      );

      // Emit to sender for blue ticks immediately
      if (req.io && req.userSockets) {
        const senderSocketId = req.userSockets.get(senderId);
        if (senderSocketId && messageIds.length > 0) {
          req.io.to(senderSocketId).emit("messagesStatusUpdate", {
            messageIds,
            status: "seen",
            seenAt
          });
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit a note
router.put("/:id", async (req, res) => {
  try {
    const { noteText, userId } = req.body;
    let note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });
    if (note.senderId !== userId) return res.status(403).json({ error: "Unauthorized to edit this note" });

    // WhatsApp logic gates:
    if (note.attachments && note.attachments.length > 0) return res.status(400).json({ error: "Cannot edit messages with attachments" });
    if (note.isDeletedForEveryone || (note.deletedForUsers && note.deletedForUsers.includes(userId))) return res.status(400).json({ error: "Cannot edit a deleted message" });
    if (Date.now() - new Date(note.timestamp).getTime() > 900000) return res.status(400).json({ error: "Messages can only be edited within 15 minutes of sending" });

    note.noteText = noteText;
    note.isEdited = true;
    note.editedAt = Date.now();
    await note.save();

    const populatedNote = await Note.findById(note._id).populate("replyTo");

    if (req.io) req.io.emit("noteUpdated", populatedNote);
    res.json(populatedNote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Get unread counts
router.get("/unread-counts/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const unreadStats = await Note.aggregate([
      {
        $facet: {
          privateCounts: [
            {
              $match: {
                receiverId: userId,
                isRead: { $ne: true }
              }
            },
            {
              $group: {
                _id: "$senderId",
                count: { $sum: 1 }
              }
            }
          ],
          groupCount: [
            {
              $match: {
                isGroup: true,
                senderId: { $ne: userId },
                readBy: { $ne: userId }
              }
            },
            {
              $group: {
                _id: "$receiverId",
                count: { $sum: 1 }
              }
            }
          ]
        }
      }
    ]);

    const counts = {};
    if (unreadStats[0]) {
      // Format private counts
      unreadStats[0].privateCounts.forEach(stat => {
        counts[stat._id] = stat.count;
      });

      // Format group counts
      if (unreadStats[0].groupCount) {
        unreadStats[0].groupCount.forEach(stat => {
          counts[stat._id] = stat.count;
        });
      }
    }

    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// Get Conversation List with Last Message
router.get("/conversations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const conversations = await Note.aggregate([
      // 1. Match all messages involving this user (either as sender, receiver, or groups)
      {
        $match: {
          $or: [
            { senderId: userId },
            { receiverId: userId },
            { receiverId: "global_group" } // Include global chat for everyone
          ]
        }
      },
      // 2. Sort by timestamp descending so the $first accumulator grabs the latest
      { $sort: { timestamp: -1 } },
      // 3. Normalize group IDs vs Direct Message IDs to group correctly
      {
        $addFields: {
          conversationId: {
            $cond: {
              if: { $or: [{ $eq: ["$isGroup", true] }, { $eq: ["$receiverId", "global_group"] }] },
              then: "$receiverId",
              else: {
                $cond: {
                  if: { $lt: ["$senderId", "$receiverId"] },
                  then: { $concat: ["$senderId", "_", "$receiverId"] },
                  else: { $concat: ["$receiverId", "_", "$senderId"] }
                }
              }
            }
          },
          // Identify the other user in a 1-on-1 chat
          partnerId: {
            $cond: {
              if: { $or: [{ $eq: ["$isGroup", true] }, { $eq: ["$receiverId", "global_group"] }] },
              then: "$receiverId",
              else: {
                $cond: {
                  if: { $eq: ["$senderId", userId] },
                  then: "$receiverId",
                  else: "$senderId"
                }
              }
            }
          }
        }
      },
      // 4. Group by the normalized conversation ID
      {
        $group: {
          _id: "$conversationId",
          partnerId: { $first: "$partnerId" },
          isGroup: { $first: { $or: ["$isGroup", { $eq: ["$receiverId", "global_group"] }] } },
          partnerNameCandidate: {
            $max: {
              $cond: {
                if: { $ne: ["$senderId", userId] },
                then: "$senderName",
                else: null
              }
            }
          },
          lastMessage: {
            $first: {
              _id: "$_id",
              noteText: "$noteText",
              senderId: "$senderId",
              senderName: "$senderName",
              timestamp: "$timestamp",
              attachments: "$attachments",
              isEdited: "$isEdited",
              editedAt: "$editedAt",
              isDeletedForEveryone: "$isDeletedForEveryone",
              isDeleted: "$isDeleted",
              isDeletedForMe: { $in: [userId, { $ifNull: ["$deletedForUsers", []] }] }
            }
          },
          updatedAt: { $first: "$timestamp" }
        }
      },
      // 5. Sort final conversations list by latest message time
      { $sort: { updatedAt: -1 } }
    ]);

    const conversationsWithNames = conversations.map(c => ({
      ...c,
      partnerName: c.partnerNameCandidate || `User ${c.partnerId.substring(0, 4)}...`,
      partnerNameCandidate: undefined
    }));

    res.json(conversationsWithNames);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete ALL notes
router.delete("/delete-all", async (req, res) => {
  try {
    await Note.deleteMany({});
    res.json({ success: true, message: "All notes deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pin a note
router.post("/pin/:id", async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    // Update pinned notes logic
    let pinnedNotes = await Note.find({ pinned: true }).sort({ pinnedAt: 1 });

    if (pinnedNotes.length >= 3) {
      // unpin the oldest
      const oldest = pinnedNotes[0];
      oldest.pinned = false;
      oldest.pinnedAt = null;
      await oldest.save();
    }

    note.pinned = true;
    note.pinnedAt = new Date();
    await note.save();

    const populatedNote = await Note.findById(note._id).populate("replyTo");

    if (req.io) {
      // Inform clients to update pinned status
      req.io.emit("noteUpdated", populatedNote);
      // Also broadcast other notes that might have been unpinned
      if (typeof oldest !== 'undefined' && oldest) {
        const oldPopulated = await Note.findById(oldest._id).populate("replyTo");
        req.io.emit("noteUpdated", oldPopulated);
      }
    }

    res.json(populatedNote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Unpin a note
router.post("/unpin/:id", async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Note not found" });

    note.pinned = false;
    note.pinnedAt = null;
    await note.save();

    const populatedNote = await Note.findById(note._id).populate("replyTo");

    if (req.io) {
      req.io.emit("noteUpdated", populatedNote);
    }

    res.json(populatedNote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
