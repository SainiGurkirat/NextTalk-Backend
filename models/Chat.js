const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    type: { type: String, enum: ['private', 'group'], default: 'private' },
    name: { type: String, trim: true }, // For group chats
    lastMessage: {
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        content: String,
        timestamp: Date
    }
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);