// models/Chat.js
const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  type: {
    type: String,
    enum: ['private', 'group'],
    required: true,
  },
  participants: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  ],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
  },
  // NEW: Admins field for group chats
  admins: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  ],
}, { timestamps: true }); // Mongoose adds createdAt and updatedAt automatically

// Pre-save hook to ensure private chats don't have a name
chatSchema.pre('save', function(next) {
  if (this.type === 'private' && this.name) {
    this.name = undefined; // Ensure private chats don't store a name
  }
  next();
});

const Chat = mongoose.model('Chat', chatSchema);

module.exports = Chat;