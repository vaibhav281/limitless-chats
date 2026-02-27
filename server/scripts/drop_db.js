const mongoose = require("mongoose");
const dotenv = require("dotenv");

// Load backend env vars
dotenv.config({ path: __dirname + '/../.env' });

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/limitless-notes";

async function clearDB() {
    try {
        console.log("Connecting to Database at", MONGO_URI);
        await mongoose.connect(MONGO_URI);
        console.log("Connected.");

        // Drop the database
        console.log("Dropping entire database...");
        await mongoose.connection.db.dropDatabase();

        console.log("✅ Database successfully dropped. The system is clean.");
        process.exit(0);
    } catch (err) {
        console.error("❌ Failed to drop database:", err);
        process.exit(1);
    }
}

clearDB();
