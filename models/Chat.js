// backend/models/Chat.js
const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
    participants: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        }
    ],
    type: {
        type: String,
        enum: ['private', 'group'],
        required: true
    },
    name: {
        type: String,
        trim: true,
        // Required only for group chats
        required: function() {
            return this.type === 'group';
        }
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        default: null
    },
    // For group chats, to manage administrators
    admins: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ],
    // New field to track who has hidden a private chat
    hiddenBy: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ]
}, {
    timestamps: true // Adds createdAt and updatedAt timestamps
});

// Ensure that 'name' is not required for private chats, and 'name' is unique if it exists
ChatSchema.path('name').validate(function(value) {
    if (this.type === 'private') {
        return true; // Not required for private chats
    }
    // For group chats, name is required
    return value && value.length > 0;
}, 'Group chat requires a name.');


// Pre-save hook to ensure hiddenBy is initialized as an empty array if not present
ChatSchema.pre('save', function(next) {
    if (!this.hiddenBy) {
        this.hiddenBy = [];
    }
    next();
});

module.exports = mongoose.model('Chat', ChatSchema);