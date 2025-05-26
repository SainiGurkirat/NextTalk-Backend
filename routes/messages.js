// backend/routes/messages.js
const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth'); // Your authentication middleware
const Chat = require('../models/Chat'); // Assuming you have these models
const Message = require('../models/Message');
const User = require('../models/User'); // If needed for population


// @desc    Get messages for a specific chat
// @route   GET /api/messages/:chatId
// @access  Private
router.get('/:chatId', protect, async (req, res) => {
    try {
        const chatId = req.params.chatId;

        // Ensure the current user is a participant of this chat
        const chat = await Chat.findById(chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }
        if (!chat.participants.includes(req.user.id)) {
            return res.status(403).json({ message: 'Not authorized to view messages in this chat' });
        }

        const messages = await Message.find({ chat: chatId })
            .populate('sender', 'username profilePicture') // Populate sender details
            .sort('timestamp'); // Sort by timestamp to get messages in order

        res.status(200).json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @desc    Send a message (REST fallback/alternative to Socket.IO)
// @route   POST /api/messages
// @access  Private
// (This route is typically used for a non-realtime message send, your Socket.IO part handles real-time)
router.post('/', protect, async (req, res) => {
    const { chatId, content } = req.body;

    if (!chatId || !content) {
        return res.status(400).json({ message: 'Chat ID and content are required' });
    }

    try {
        const chat = await Chat.findById(chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }
        // Ensure the sender is a participant of the chat
        if (!chat.participants.includes(req.user.id)) {
            return res.status(403).json({ message: 'Not authorized to send message in this chat' });
        }

        const newMessage = new Message({
            chat: chatId,
            sender: req.user._id, // Sender is the authenticated user
            content,
        });

        const savedMessage = await newMessage.save();

        // Optionally update the chat's lastMessage and updatedAt fields
        chat.lastMessage = {
            sender: savedMessage.sender,
            content: savedMessage.content,
            timestamp: savedMessage.timestamp
        };
        chat.updatedAt = savedMessage.timestamp;
        await chat.save();

        // Populate sender details for the response
        const populatedMessage = await Message.findById(savedMessage._id)
            .populate('sender', 'username profilePicture');

        res.status(201).json(populatedMessage);
    } catch (error) {
        console.error('Error sending message (REST):', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;