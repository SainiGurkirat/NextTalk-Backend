const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat'); // Ensure your Chat model is defined
const Message = require('../models/Message'); // Ensure your Message model is defined
const authenticateToken = require('../middleware/auth'); // Your JWT authentication middleware

// Route to create a new chat (private or group)
// Accessible at: POST /api/chats
router.post('/', authenticateToken, async (req, res) => {
    // --- ADD THIS LINE FOR DEBUGGING ---
    console.log('DEBUG (Backend/createChat): req.user object:', req.user);
    // ------------------------------------

    try {
        const { participantIds, type, name } = req.body;
        // CORRECTED: Use req.user.userId to match the actual JWT payload structure
        const currentUserId = req.user.userId; 

        console.log('DEBUG (Backend/createChat): Incoming participantIds from frontend:', participantIds);
        console.log('DEBUG (Backend/createChat): Current User ID (from JWT):', currentUserId);
        console.log('DEBUG (Backend/createChat): Requested Chat Type:', type);

        // Ensure current user is always a participant
        // IMPORTANT: Use .some() with toString() for ObjectId comparison in array
        if (!participantIds.some(id => id.toString() === currentUserId.toString())) {
            console.log('DEBUG (Backend/createChat): Current user not found in participantIds. Adding current user.');
            participantIds.push(currentUserId);
        } else {
            console.log('DEBUG (Backend/createChat): Current user already in participantIds. Not adding again.');
        }

        console.log('DEBUG (Backend/createChat): Participant IDs AFTER current user check:', participantIds);
        console.log('DEBUG (Backend/createChat): Participant IDs length AFTER check:', participantIds.length);

        // Basic validation for private chats
        if (type === 'private' && participantIds.length !== 2) {
            console.error('ERROR (Backend/createChat): Private chat validation failed. Expected 2 participants, got:', participantIds.length);
            return res.status(400).json({ message: 'Private chats must have exactly two participants.' });
        }

        // For private chats, check if a chat already exists between these two users
        if (type === 'private') {
            const existingChat = await Chat.findOne({
                type: 'private',
                // Ensure both participants are present, and there are exactly two
                participants: { $all: participantIds, $size: 2 } 
            });
            if (existingChat) {
                console.log('DEBUG (Backend/createChat): Existing private chat found:', existingChat._id);
                return res.status(200).json({ message: 'Private chat already exists', chat: existingChat });
            }
        }

        const newChat = new Chat({
            participants: participantIds,
            type: type || 'private', // Default to private if not specified
            name: type === 'group' ? name : undefined // Only set name for group chats
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
        // CORRECTED: Use req.user.userId to match the actual JWT payload structure
        const currentUserId = req.user.userId; 
        const chats = await Chat.find({ participants: currentUserId })
            .populate('participants', 'username profilePicture') // Populate participant details
            .sort({ 'lastMessage.timestamp': -1 }); // Sort by last message time, descending

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
        // CORRECTED: Use req.user.userId to match the actual JWT payload structure
        const currentUserId = req.user.userId; 

        // Verify user is a participant of the chat for security
        const chat = await Chat.findById(chatId);
        if (!chat || !chat.participants.includes(currentUserId)) {
            return res.status(403).json({ message: 'Access denied to this chat' });
        }

        const messages = await Message.find({ chat: chatId })
            .populate('sender', 'username profilePicture') // Populate sender details
            .sort({ timestamp: 1 }); // Sort by time ascending

        res.status(200).json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error fetching messages' });
    }
});

// Route to get a single chat's details by ID (useful for populating chat window)
// Accessible at: GET /api/chats/:chatId
router.get('/:chatId', authenticateToken, async (req, res) => {
    try {
        const { chatId } = req.params;
        // CORRECTED: Use req.user.userId to match the actual JWT payload structure
        const currentUserId = req.user.userId; 

        const chat = await Chat.findById(chatId)
                                .populate('participants', 'username profilePicture');

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        // Ensure the current user is a participant of this chat
        // Convert to string for reliable comparison with populated ObjectId
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
