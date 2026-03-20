const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/myNotesDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('Connected to DB. Dropping database...');
  await mongoose.connection.db.dropDatabase();
  console.log('Database dropped successfully.');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
