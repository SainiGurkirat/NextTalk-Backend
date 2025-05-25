const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat'); // Ensure your Chat model is defined
const Message = require('../models/Message'); // Ensure your Message model is defined
const authenticateToken = require('../middleware/auth'); // Your JWT authentication middleware

// Route to create a new chat (private or group)
// Accessible at: POST /api/chats
router.post('/', authenticateToken, async (req, res) => {
    console.log('DEBUG (Backend/createChat): req.user object:', req.user);

    try {
        const { participantIds, type, name } = req.body;
        const currentUserId = req.user.userId; // Assuming req.user.userId from your auth middleware

        console.log('DEBUG (Backend/createChat): Incoming participantIds from frontend:', participantIds);
        console.log('DEBUG (Backend/createChat): Current User ID (from JWT):', currentUserId);
        console.log('DEBUG (Backend/createChat): Requested Chat Type:', type);

        if (!participantIds.some(id => id.toString() === currentUserId.toString())) {
            console.log('DEBUG (Backend/createChat): Current user not found in participantIds. Adding current user.');
            participantIds.push(currentUserId);
        } else {
            console.log('DEBUG (Backend/createChat): Current user already in participantIds. Not adding again.');
        }

        console.log('DEBUG (Backend/createChat): Participant IDs AFTER current user check:', participantIds);
        console.log('DEBUG (Backend/createChat): Participant IDs length AFTER check:', participantIds.length);

        if (type === 'private' && participantIds.length !== 2) {
            console.error('ERROR (Backend/createChat): Private chat validation failed. Expected 2 participants, got:', participantIds.length);
            return res.status(400).json({ message: 'Private chats must have exactly two participants.' });
        }

        if (type === 'private') {
            const existingChat = await Chat.findOne({
                type: 'private',
                participants: { $all: participantIds, $size: 2 }
            });
            if (existingChat) {
                console.log('DEBUG (Backend/createChat): Existing private chat found:', existingChat._id);
                return res.status(200).json({ message: 'Private chat already exists', chat: existingChat });
            }
        }

        const newChat = new Chat({
            participants: participantIds,
            type: type || 'private',
            name: type === 'group' ? name : undefined
        });
        await newChat.save();

        const populatedChat = await Chat.findById(newChat._id)
                                        .populate('participants', 'username profilePicture');

        console.log('DEBUG (Backend/createChat): Chat created successfully:', populatedChat._id);
        res.status(201).json({ message: 'Chat created successfully', chat: populatedChat });

    } catch (error) {
        console.error('ERROR (Backend/createChat): Server error during chat creation:', error);
        res.status(500).json({ message: 'Server error creating chat' });
    }
});

// Route to get all chats for the current authenticated user
// Accessible at: GET /api/chats
router.get('/', authenticateToken, async (req, res) => {
    try {
        const currentUserId = req.user.userId; // Assuming req.user.userId from your auth middleware
        const chats = await Chat.find({ participants: currentUserId })
            .populate('participants', 'username profilePicture')
            // --- POPULATING LASTMESSAGE AND ITS SENDER/CONTENT ---
            .populate({
                path: 'lastMessage',
                select: 'content timestamp sender',
                populate: {
                    path: 'sender',
                    select: 'username _id profilePicture' // Ensure _id is selected for comparison on frontend
                }
            })
            // -------------------------------------------------------------
            .sort({ 'updatedAt': -1, 'lastMessage.timestamp': -1 }); // Sort by chat update time first, then last message time

        res.status(200).json(chats);
    } catch (error) {
        console.error('Error fetching chats:', error);
        res.status(500).json({ message: 'Server error fetching chats' });
    }
});

// Route to get messages for a specific chat
// Accessible at: GET /api/chats/:chatId/messages
router.get('/:chatId/messages', authenticateToken, async (req, res) => {
    try {
        const { chatId } = req.params;
        const currentUserId = req.user.userId; // Assuming req.user.userId from your auth middleware

        const chat = await Chat.findById(chatId);
        if (!chat || !chat.participants.some(p => p.toString() === currentUserId.toString())) {
            return res.status(403).json({ message: 'Access denied to this chat' });
        }

        const messages = await Message.find({ chat: chatId })
            .populate('sender', 'username profilePicture')
            .sort({ timestamp: 1 });

        res.status(200).json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error fetching messages' });
    }
});

// --- NEW ROUTE: POST /api/chats/:chatId/messages (SEND MESSAGE) ---
router.post('/:chatId/messages', authenticateToken, async (req, res) => {
    const { chatId } = req.params;
    const { content } = req.body;
    const senderId = req.user.userId; // Assuming req.user.userId from your auth middleware

    if (!content || typeof content !== 'string' || content.trim() === '') {
        return res.status(400).json({ message: 'Message content is required and cannot be empty.' });
    }

    try {
        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        if (!chat.participants.some(p => p.toString() === senderId.toString())) {
             return res.status(403).json({ message: 'Not authorized to send messages to this chat' });
        }

        const newMessage = new Message({
            chat: chatId,
            sender: senderId,
            content: content,
            timestamp: new Date(),
        });

        const savedMessage = await newMessage.save();

        // Update the chat's lastMessage field and updatedAt timestamp
        chat.lastMessage = savedMessage._id; // This will now correctly store the Message _id
        chat.updatedAt = new Date(); // Update chat's last activity
        await chat.save();

        // Populate sender details for the response to the frontend (for optimistic update correction)
        await savedMessage.populate('sender', 'username _id profilePicture');

        res.status(201).json(savedMessage);
    } catch (error) {
        console.error('Backend: Error sending message:', error);
        res.status(500).json({ message: 'Server error while sending message' });
    }
});
// ------------------------------------------------------------------

// Route to get a single chat's details by ID
// Accessible at: GET /api/chats/:chatId
router.get('/:chatId', authenticateToken, async (req, res) => {
    try {
        const { chatId } = req.params;
        const currentUserId = req.user.userId; // Assuming req.user.userId from your auth middleware

        const chat = await Chat.findById(chatId)
                               .populate('participants', 'username profilePicture');

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        if (!chat.participants.some(p => p._id.toString() === currentUserId.toString())) {
            return res.status(403).json({ message: 'Access denied to this chat' });
        }

        res.status(200).json(chat);
    } catch (error) {
        console.error('Error fetching chat by ID:', error);
        res.status(500).json({ message: 'Server error fetching chat' });
    }
});

module.exports = router;