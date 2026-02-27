const mongoose = require('mongoose');
const UserKey = require('./models/UserKey');
const User = require('./models/User');

async function go() {
    try {
        await mongoose.connect("mongodb://127.0.0.1:27017/myNotesDB");
        const users = await User.find({}, '_id username email');
        console.log("USERS:", JSON.stringify(users, null, 2));
        const keys = await UserKey.find({}, 'userId registrationId');
        console.log("KEYS:", JSON.stringify(keys, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
go();
