const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    chat: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chat',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    content: {
        type: String,
        trim: true
    },
    mediaUrl: {
        type: String,
        default: null
    },
    mediaType: {
        type: String, // 'image', 'video', 'gif'
        enum: ['image', 'video', 'gif', null],
        default: null
    },
    readBy: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ],
    isSystemMessage: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: true
});

// validation to ensure either content or mediaUrl is present
MessageSchema.pre('save', function(next) {
    if (!this.content && !this.mediaUrl) {
        return next(new Error('Message must have either content or mediaUrl.'));
    }
    next();
});


module.exports = mongoose.model('Message', MessageSchema);