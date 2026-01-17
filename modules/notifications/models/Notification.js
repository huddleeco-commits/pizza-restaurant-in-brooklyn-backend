const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    type: {
        type: String,
        enum: ['bet_accepted', 'bet_cancelled', 'comment', 'like', 'follow', 'prediction_result', 'mention', 'league_invite', 'league_joined'],
        required: true
    },
    title: {
        type: String
    },
    message: {
        type: String,
        required: true
    },
    data: {
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
        betId: String,
        commentId: String,
        amount: Number,
        result: String,
        leagueId: { type: mongoose.Schema.Types.ObjectId, ref: 'League' },
        platformId: String,
        leagueCode: String,
        inviterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        inviterName: String
    },
    read: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for faster queries
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);