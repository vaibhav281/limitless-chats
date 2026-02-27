const mongoose = require('mongoose');
const Note = require('./models/Note');
mongoose.connect('mongodb://127.0.0.1:27017/my_mean_notes_app').then(async () => {
    const c = await Note.countDocuments();
    console.log('Total notes:', c);
    const unreadStats = await Note.aggregate([
        {
            $facet: {
                privateCounts: [
                    {
                        $match: {
                            isRead: { $ne: true }
                        }
                    },
                    {
                        $group: {
                            _id: { receiverId: "$receiverId", senderId: "$senderId" },
                            count: { $sum: 1 }
                        }
                    }
                ],
                globalCount: [
                    {
                        $match: {
                            receiverId: 'global_group'
                        }
                    },
                    {
                        $count: "count"
                    }
                ]
            }
        }
    ]);
    console.log(JSON.stringify(unreadStats, null, 2));
    process.exit(0);
});
