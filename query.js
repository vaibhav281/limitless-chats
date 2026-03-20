const mongoose = require('mongoose');
const Note = require('./server/models/Note.js');

mongoose.connect('mongodb://127.0.0.1:27017/limitless-chats').then(async () => {
  const notes = await Note.find({ 'attachments.0': { $exists: true } }).sort({createdAt:-1}).limit(1);
  if (notes.length > 0) {
    console.log(JSON.stringify(notes[0].attachments, null, 2));
  } else {
    console.log("No attachments found");
  }
  process.exit(0);
}).catch(console.error);
