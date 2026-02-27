const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const Note = require("./models/Note");

dotenv.config({ path: path.join(__dirname, '.env') });
connectDB();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // allow frontend access
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

const userSockets = new Map(); // userId -> socket.id
const activeUsers = new Map(); // userId -> { userId, username }

// Attach io and userSockets to every request so routes can emit events
app.use((req, res, next) => {
    req.io = io;
    req.userSockets = userSockets;
    next();
});

io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    socket.on("register", async (userData) => {
        const { userId, username } = userData;
        if (!userId) return;

        userSockets.set(userId, socket.id);
        activeUsers.set(userId, { userId, username });

        console.log(`✅ Registered User: ${username} (${userId}) mapped to socket: ${socket.id}`);

        // Broadcast online users to everyone (legacy array)
        io.emit("activeUsers", Array.from(activeUsers.values()));
        // Granular presence update
        io.emit("user_presence_update", { userId, status: "online", username });

        // Deliver pending offline messages instantly
        try {
            const pendingNotes = await Note.find({ receiverId: userId, status: "sent" });
            if (pendingNotes.length > 0) {
                const deliveredAt = new Date();
                await Note.updateMany(
                    { receiverId: userId, status: "sent" },
                    { $set: { status: "delivered", deliveredAt } }
                );

                const senders = {};
                pendingNotes.forEach(note => {
                    if (!senders[note.senderId]) senders[note.senderId] = [];
                    senders[note.senderId].push(note._id);
                });

                for (const [sId, msgIds] of Object.entries(senders)) {
                    const sSocketId = userSockets.get(sId);
                    if (sSocketId) {
                        io.to(sSocketId).emit("messagesStatusUpdate", {
                            messageIds: msgIds,
                            status: "delivered",
                            deliveredAt
                        });
                    }
                }
            }
        } catch (err) {
            console.error("Error delivering offline messages:", err);
        }
    });

    socket.on("disconnect", () => {
        console.log(`🛑 Client disconnected: ${socket.id}`);
        // Remove from maps
        let disconnectedUserId = null;
        for (const [userId, sId] of userSockets.entries()) {
            if (sId === socket.id) {
                disconnectedUserId = userId;
                userSockets.delete(userId);
                activeUsers.delete(userId);
                break;
            }
        }
        if (disconnectedUserId) {
            io.emit("activeUsers", Array.from(activeUsers.values()));
            io.emit("user_presence_update", { userId: disconnectedUserId, status: "offline" });
            console.log(`❌ Unregistered User: ${disconnectedUserId}`);
        }
    });

    socket.on("message_delivered", async (messageId) => {
        try {
            const note = await Note.findById(messageId);
            if (note && note.status === "sent") {
                note.status = "delivered";
                note.deliveredAt = new Date();
                await note.save();

                const senderSocketId = userSockets.get(note.senderId);
                if (senderSocketId) {
                    io.to(senderSocketId).emit("messageStatusUpdate", {
                        messageId,
                        status: "delivered",
                        deliveredAt: note.deliveredAt
                    });
                }
            }
        } catch (err) {
            console.error("Error updating delivered status:", err);
        }
    });

    socket.on("message_seen", async ({ chatId, messageIds }) => {
        try {
            if (!messageIds || messageIds.length === 0) return;

            await Note.updateMany(
                { _id: { $in: messageIds }, status: { $ne: "seen" } },
                { $set: { status: "seen", seenAt: new Date() } }
            );

            // Fetch one note to determine sender to notify
            const note = await Note.findById(messageIds[0]);
            if (note) {
                const senderSocketId = userSockets.get(note.senderId);
                if (senderSocketId) {
                    io.to(senderSocketId).emit("messagesStatusUpdate", {
                        messageIds,
                        status: "seen",
                        seenAt: new Date()
                    });
                }
            }
        } catch (err) {
            console.error("Error updating seen status:", err);
        }
    });

    // In case front-end sends a message through WebSocket instead of HTTP, 
    // it's good practice to have but since we use REST API for posting, this isn't strictly needed here.
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/v1/auth", require("./features/auth/auth.routes"));
app.use("/api/v1/notes", require("./routes/noteRoutes"));
app.use("/api/v1/keys", require("./routes/keyRoutes"));

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
