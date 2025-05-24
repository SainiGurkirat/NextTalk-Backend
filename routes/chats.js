const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const authenticateToken = require('../middleware/auth'); // 

// Create a new chat
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { participantIds, type, name } = req.body;
        const currentUserId = req.user.id;

        if (!participantIds.includes(currentUserId)) {
            participantIds.push(currentUserId);
        }

        if (type === 'private' && participantIds.length !== 2) {
            return res.status(400).json({ message: 'Private chats must have exactly two participants.' });
        }

        if (type === 'private') {
            const existingChat = await Chat.findOne({
                type: 'private',
                participants: { $all: participantIds, $size: 2 }
            });
            if (existingChat) {
                return res.status(200).json({ message: 'Private chat already exists', chat: existingChat });
            }
        }

        const newChat = new Chat({
            participants: participantIds,
            type: type || 'private',
            name: type === 'group' ? name : undefined
        });
        await newChat.save();
        res.status(201).json({ message: 'Chat created successfully', chat: newChat });

    } catch (error) {
        console.error('Create chat error:', error);
        res.status(500).json({ message: 'Server error creating chat' });
    }
});

// Get all chats for the current user
router.get('/', authenticateToken, async (req, res) => {
    try {
        const chats = await Chat.find({ participants: req.user.id })
            .populate('participants', 'username profilePicture')
            .sort({ 'lastMessage.timestamp': -1 });

        res.status(200).json(chats);
    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({ message: 'Server error fetching chats' });
    }
});

// Get messages for a specific chat
router.get('/:chatId/messages', authenticateToken, async (req, res) => {
    try {
        const { chatId } = req.params;
        const currentUserId = req.user.id;

        const chat = await Chat.findById(chatId);
        if (!chat || !chat.participants.includes(currentUserId)) {
            return res.status(403).json({ message: 'Access denied to this chat' });
        }

        const messages = await Message.find({ chat: chatId })
            .populate('sender', 'username profilePicture')
            .sort({ timestamp: 1 });

        res.status(200).json(messages);
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ message: 'Server error fetching messages' });
    }
});

module.exports = router;