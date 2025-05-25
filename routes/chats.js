// backend/routes/chats.js
const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const authenticateToken = require('../middleware/auth');
const mongoose = require('mongoose'); // Import mongoose for operations like .toObject()

// Route to create a new chat (private or group)
// Accessible at: POST /api/chats
router.post('/', authenticateToken, async (req, res) => {
    console.log('DEBUG (Backend/createChat): req.user object:', req.user);

    try {
        const { participantIds, type, name } = req.body;
        const currentUserId = req.user.userId;

        console.log('DEBUG (Backend/createChat): Incoming participantIds from frontend:', participantIds);
        console.log('DEBUG (Backend/createChat): Current User ID (from JWT):', currentUserId);
        console.log('DEBUG (Backend/createChat): Requested Chat Type:', type);

        // Ensure current user is in participants
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
                // If chat exists, just return it without creating a new one
                const populatedExistingChat = await Chat.findById(existingChat._id)
                                        .populate('participants', 'username profilePicture');
                return res.status(200).json({ message: 'Private chat already exists', chat: populatedExistingChat });
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
        const currentUserId = req.user.userId;
        const chats = await Chat.find({ participants: currentUserId })
            .populate('participants', 'username profilePicture')
            .populate({
                path: 'lastMessage',
                select: 'content timestamp sender readBy', // Add readBy here
                populate: {
                    path: 'sender',
                    select: 'username _id profilePicture'
                }
            })
            .sort({ 'updatedAt': -1, 'lastMessage.timestamp': -1 });

        // Calculate unread message count for each chat
        const chatsWithUnread = await Promise.all(chats.map(async (chat) => {
            const unreadCount = await Message.countDocuments({
                chat: chat._id,
                sender: { $ne: currentUserId }, // Messages not sent by the current user
                readBy: { $nin: [currentUserId] } // Messages not read by the current user
            });
            return {
                ...chat.toObject(), // Convert Mongoose document to plain JavaScript object
                unreadCount: unreadCount
            };
        }));

        res.status(200).json(chatsWithUnread);
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
        const currentUserId = req.user.userId;

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

// ROUTE: POST /api/chats/:chatId/messages (SEND MESSAGE)
router.post('/:chatId/messages', authenticateToken, async (req, res) => {
    const { chatId } = req.params;
    const { content } = req.body;
    const senderId = req.user.userId;

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
            readBy: [senderId] // Mark as read by sender immediately
        });

        const savedMessage = await newMessage.save();

        chat.lastMessage = savedMessage._id;
        chat.updatedAt = new Date();
        await chat.save();

        // Populate sender details for the response to the frontend and Socket.IO
        await savedMessage.populate('sender', 'username _id profilePicture');

        // --- Socket.IO Emission for Real-Time Updates ---
        if (req.io) {
            // 1. Emit the saved message to all clients in this chat room
            // The message object should be fully populated as the frontend expects
            const messageToSend = savedMessage.toObject();
            req.io.to(chatId).emit('receive_message', messageToSend);
            console.log(`Backend Socket: Emitted 'receive_message' to chat ${chatId}`);

            // 2. Emit to each participant's personal room for chat list updates
            // This is crucial for updating unread counts in the sidebar for users NOT in the active chat
            chat.participants.forEach(participantId => {
                const participantSocketId = `user_${participantId.toString()}`;
                // Only send chat_list_update if the participant is NOT the sender
                // The sender's client will handle its own optimistic update and current chat unread count.
                if (participantId.toString() !== senderId.toString()) {
                    req.io.to(participantSocketId).emit('chat_list_update', {
                        chatId: chat._id,
                        lastMessage: messageToSend, // Send the full message to update lastMessage display
                        senderId: senderId // Identify who sent it
                    });
                    console.log(`Backend Socket: Emitted 'chat_list_update' to user ${participantId.toString()} for chat ${chat._id}`);
                }
            });

        } else {
            console.warn('Backend: req.io is not available. Socket.IO events will not be emitted.');
        }
        // --------------------------------------------------

        res.status(201).json(savedMessage);
    } catch (error) {
        console.error('Backend: Error sending message:', error);
        res.status(500).json({ message: 'Server error while sending message' });
    }
});

// ROUTE: POST /api/chats/:chatId/markAsRead
// Marks all messages in a chat (that were not sent by current user) as read for the current user
router.post('/:chatId/markAsRead', authenticateToken, async (req, res) => {
    try {
        const { chatId } = req.params;
        const currentUserId = req.user.userId;

        // Find the chat to ensure user is a participant
        const chat = await Chat.findById(chatId);
        if (!chat || !chat.participants.some(p => p.toString() === currentUserId.toString())) {
            return res.status(403).json({ message: 'Access denied to this chat or chat not found.' });
        }

        // Update messages: Add currentUserId to readBy array for messages
        // that are in this chat, not sent by current user, and not already read by current user.
        const result = await Message.updateMany(
            {
                chat: chatId,
                sender: { $ne: currentUserId }, // Messages not sent by the current user
                readBy: { $nin: [currentUserId] } // Messages not already read by the current user
            },
            {
                $addToSet: { readBy: currentUserId } // Add currentUserId to readBy if not already present
            }
        );

        console.log(`Marked ${result.modifiedCount} messages as read in chat ${chatId} for user ${currentUserId}`);
        res.status(200).json({ message: 'Messages marked as read', modifiedCount: result.modifiedCount });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ message: 'Server error marking messages as read' });
    }
});


// Route to get a single chat's details by ID
// Accessible at: GET /api/chats/:chatId
router.get('/:chatId', authenticateToken, async (req, res) => {
    try {
        const { chatId } = req.params;
        const currentUserId = req.user.userId;

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