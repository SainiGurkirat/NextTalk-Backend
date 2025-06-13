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
        // required only for group chats
        required: function() {
            return this.type === 'group';
        }
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        default: null
    },

    // for group chats. to manage administrators
    admins: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ],

    // new field to track who has hidden a private chat
    hiddenBy: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ]
}, {
    timestamps: true
});


ChatSchema.path('name').validate(function(value) {
    if (this.type === 'private') {
        return true; // not required for private chats
    }
    // for group chats. name is required
    return value && value.length > 0;
}, 'Group chat requires a name.');


ChatSchema.pre('save', function(next) {
    if (!this.hiddenBy) {
        this.hiddenBy = [];
    }
    next();
});

module.exports = mongoose.model('Chat', ChatSchema);