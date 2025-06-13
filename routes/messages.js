const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth'); 
const Chat = require('../models/Chat'); 
const Message = require('../models/Message');
const User = require('../models/User'); 

router.get('/:chatId', protect, async (req, res) => {
    try {
        const chatId = req.params.chatId;

        // ensure the current user is a participant of this chat
        const chat = await Chat.findById(chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }
        if (!chat.participants.includes(req.user.id)) {
            return res.status(403).json({ message: 'Not authorized to view messages in this chat' });
        }

        const messages = await Message.find({ chat: chatId })
            .populate('sender', 'username profilePicture') 
            .sort('timestamp'); 

        res.status(200).json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

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

        // ensure the sender is a participant of the chat
        if (!chat.participants.includes(req.user.id)) {
            return res.status(403).json({ message: 'Not authorized to send message in this chat' });
        }

        const newMessage = new Message({
            chat: chatId,
            sender: req.user._id,
            content,
        });

        const savedMessage = await newMessage.save();

        chat.lastMessage = {
            sender: savedMessage.sender,
            content: savedMessage.content,
            timestamp: savedMessage.timestamp
        };
        chat.updatedAt = savedMessage.timestamp;
        await chat.save();
        
        const populatedMessage = await Message.findById(savedMessage._id)
            .populate('sender', 'username profilePicture');

        res.status(201).json(populatedMessage);
    } catch (error) {
        console.error('Error sending message (REST):', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;