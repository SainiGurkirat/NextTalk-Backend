// backend/models/Chat.js - UPDATED
const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    type: { type: String, enum: ['private', 'group'], default: 'private' },
    name: { type: String, trim: true }, // For group chats
    lastMessage: { // <--- CHANGE THIS TO A REFERENCE TO A MESSAGE ID
        type: mongoose.Schema.Types.ObjectId, // It's an ObjectId
        ref: 'Message' // It refers to the 'Message' model
    }
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);