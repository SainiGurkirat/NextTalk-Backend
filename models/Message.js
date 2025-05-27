// backend/models/Message.js
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
    // New fields for media attachments
    mediaUrl: {
        type: String,
        default: null
    },
    mediaType: {
        type: String, // e.g., 'image', 'video', 'gif'
        enum: ['image', 'video', 'gif', null], // Add null to allow messages without media
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

// Add a validation to ensure either content or mediaUrl is present
MessageSchema.pre('save', function(next) {
    if (!this.content && !this.mediaUrl) {
        return next(new Error('Message must have either content or mediaUrl.'));
    }
    next();
});


module.exports = mongoose.model('Message', MessageSchema);