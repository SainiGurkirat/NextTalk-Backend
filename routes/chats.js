// routes/chats.js (assuming this is your chatRoutes.js)
const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth'); // Your JWT auth middleware
const mongoose = require('mongoose');
// REMOVED: `let io;` and `setIoInstance` as `io` is now available via `req.io`

router.post('/:chatId/markAsRead', authMiddleware, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: 'Invalid chat ID format' });
        }

        const chat = await Chat.findById(chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        // Ensure the user is a participant of the chat
        if (!chat.participants.includes(userId)) {
            return res.status(403).json({ message: 'Not authorized to mark messages in this chat' });
        }

        // Find all messages in the chat that are not sent by the current user
        // AND where the current user is NOT already in the readBy array
        const result = await Message.updateMany(
            {
                chat: chatId,
                sender: { $ne: userId }, // Don't mark your own messages as unread by yourself
                readBy: { $ne: userId } // Only messages not yet read by this user
            },
            {
                $addToSet: { readBy: userId } // Add user ID to readBy array if not already present
            },
            { new: true } // Return the updated documents (not strictly needed for updateMany, but good practice)
        );

        // Optionally, you might want to emit a socket event to update unread counts
        // for the user on other connected devices or for other users in the chat
        if (req.io) {
             // Emit to the user who just marked messages as read, to update their unread count badge
             req.io.to(`user_${userId.toString()}`).emit('chatRead', { chatId: chatId.toString() });

             // Optionally, if you want other participants to see messages marked as read in real-time,
             // you'd emit 'messageReadStatusUpdated' to the chat room.
             // This would require frontend logic to handle that event and update message UI.
             // For now, focusing on solving the 404.
        }


        // Send back a success response, maybe with the count of messages updated
        res.status(200).json({ message: 'Messages marked as read successfully', updatedCount: result.modifiedCount });

    } catch (err) {
        console.error('Error marking messages as read:', err.message);
        res.status(500).send('Server Error');
    }
});

// Helper function to check if a user is an admin of a chat
const isAdmin = (chat, userId) => {
    // chat.admins will contain ObjectId's, so convert userId to string for comparison
    return chat.admins.some(adminId => adminId.toString() === userId.toString());
};

// @route   GET /api/chats
// @desc    Get all chats for the authenticated user
// @access  Private
// @route   POST /api/chats/:chatId/messages
// @desc    Send a new message to a chat
// @access  Private
router.get('/:chatId/messages', authMiddleware, async (req, res) => {
    try {
        const chat = await Chat.findById(req.params.chatId);

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        // Ensure the current user is a participant of this chat
        // Converting to string for consistent comparison
        if (!chat.participants.some(p => p.toString() === req.user.id.toString())) {
            return res.status(403).json({ message: 'Not authorized to view messages in this chat' });
        }

        const messages = await Message.find({ chat: req.params.chatId })
            .populate('sender', 'username profilePicture')
            .sort({ createdAt: 1 }); // Sort by creation date ascending

        res.status(200).json(messages);
    } catch (err) {
        console.error('Error fetching messages:', err.message);
        res.status(500).send('Server Error');
    }
});


// @route   POST /api/chats/:chatId/messages
// @desc    Send a new message to a chat
// @access  Private
// (This was in the previous response, ensure it's also present)
router.post('/:chatId/messages', authMiddleware, async (req, res) => {
    const { content } = req.body;
    const chatId = req.params.chatId;
    const senderId = req.user.id;

    if (!content || content.trim() === '') {
        return res.status(400).json({ message: 'Message content cannot be empty' });
    }
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({ message: 'Invalid chat ID format' });
    }

    try {
        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        if (!chat.participants.map(p => p.toString()).includes(senderId.toString())) {
             return res.status(403).json({ message: 'Not authorized to send messages to this chat' });
        }

        const newMessage = new Message({
            chat: chatId,
            sender: senderId,
            content,
        });

        const savedMessage = await newMessage.save();

        chat.lastMessage = savedMessage._id;
        chat.updatedAt = Date.now();
        await chat.save();

        await savedMessage.populate('sender', 'username profilePicture');

        const messageData = {
            _id: savedMessage._id.toString(),
            chat: savedMessage.chat.toString(),
            sender: {
                _id: savedMessage.sender._id.toString(),
                username: savedMessage.sender.username,
                profilePicture: savedMessage.sender.profilePicture || null,
            },
            content: savedMessage.content,
            readBy: savedMessage.readBy ? savedMessage.readBy.map(id => id.toString()) : [],
            createdAt: savedMessage.createdAt.toISOString(),
            updatedAt: savedMessage.updatedAt.toISOString(),
        };

        if (req.io) {
            req.io.to(chatId.toString()).emit('newMessage', messageData);
            chat.participants.forEach(participantId => {
                req.io.to(`user_${participantId.toString()}`).emit('chatUpdated', {
                    _id: chat._id.toString(),
                    lastMessage: {
                        sender: {
                            _id: messageData.sender._id,
                            username: messageData.sender.username,
                            profilePicture: messageData.sender.profilePicture
                        },
                        content: messageData.content,
                        timestamp: messageData.createdAt
                    },
                    updatedAt: chat.updatedAt.toISOString(),
                });
            });
        }

        res.status(201).json(messageData);
    } catch (err) {
        console.error('Error sending message:', err.message);
        res.status(500).send('Server Error');
    }
});

router.get('/', authMiddleware, async (req, res) => {
    try {
        const chats = await Chat.find({ participants: req.user.id })
            .populate({
                path: 'participants',
                select: 'username profilePicture',
            })
            .populate({
                path: 'lastMessage',
                populate: {
                    path: 'sender',
                    select: 'username profilePicture',
                },
            })
            .sort({ updatedAt: -1 });

        // Use Promise.all to handle asynchronous operations within map callback
        const chatsDataPromises = chats.map(async (chat) => { // Mark callback as async
            let chatName = chat.name;
            const otherParticipants = chat.participants.filter(p => p._id.toString() !== req.user.id);
            let recipientInfo = null;

            if (chat.type === 'private') {
                if (otherParticipants.length > 0) {
                    recipientInfo = {
                        _id: otherParticipants[0]._id.toString(),
                        username: otherParticipants[0].username,
                        profilePicture: otherParticipants[0].profilePicture,
                    };
                    if (!chatName) {
                        chatName = otherParticipants[0].username;
                    }
                } else {
                    chatName = req.user.username; // Self-chat
                }
            } else if (chat.type === 'group') {
                if (!chatName) {
                    const participantNames = otherParticipants.map(p => p.username).slice(0, 3);
                    chatName = `${participantNames.join(', ')}${chat.participants.length > 4 ? '...' : ''} Group`;
                }
            }

            let unreadCount = 0;
            if (chat.lastMessage && chat.lastMessage.sender.toString() !== req.user.id) {
                // This await is now correctly within an async function (the map callback)
                const unreadMessages = await Message.find({
                    chat: chat._id,
                    sender: { $ne: req.user.id },
                    readBy: { $ne: req.user.id }
                });
                unreadCount = unreadMessages.length;
            }

            return {
                _id: chat._id.toString(),
                name: chatName,
                type: chat.type,
                participants: chat.participants.map(p => ({
                    _id: p._id.toString(),
                    username: p.username,
                    profilePicture: p.profilePicture,
                })),
                recipient: recipientInfo, // Only for private chats
                lastMessage: chat.lastMessage ? {
                    sender: {
                        _id: chat.lastMessage.sender._id.toString(),
                        username: chat.lastMessage.sender.username,
                        profilePicture: chat.lastMessage.sender.profilePicture,
                    },
                    content: chat.lastMessage.content,
                    timestamp: chat.lastMessage.createdAt.toISOString(),
                    readBy: chat.lastMessage.readBy ? chat.lastMessage.readBy.map(id => id.toString()) : [],
                } : null,
                createdAt: chat.createdAt.toISOString(),
                updatedAt: chat.updatedAt.toISOString(),
                unreadCount: unreadCount,
                admins: chat.admins.map(adminId => adminId.toString()), // NEW: include admins
            };
        });

        // Wait for all promises from the map operation to resolve
        const chatsData = await Promise.all(chatsDataPromises);

        res.json(chatsData);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/chats
// @desc    Create a new chat (private or group)
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
    const { participants, type, name } = req.body; // participants is an array of user IDs

    if (!participants || !Array.isArray(participants) || participants.length === 0) {
        return res.status(400).json({ message: 'Participants are required.' });
    }
    if (!['private', 'group'].includes(type)) {
        return res.status(400).json({ message: 'Invalid chat type.' });
    }
    if (type === 'group' && !name) {
        return res.status(400).json({ message: 'Group chats require a name.' });
    }

    try {
        const participantObjects = await User.find({ _id: { $in: participants } });
        if (participantObjects.length !== participants.length) {
            return res.status(404).json({ message: 'One or more participants not found.' });
        }

        // Add the current user to participants if not already included
        if (!participantObjects.some(p => p._id.toString() === req.user.id)) {
            const currentUserObj = await User.findById(req.user.id);
            if (currentUserObj) {
                participantObjects.push(currentUserObj);
            }
        }

        if (type === 'private') {
            if (participantObjects.length !== 2) {
                return res.status(400).json({ message: 'Private chats must have exactly two participants.' });
            }

            // Check if a private chat already exists between these two users
            const existingChat = await Chat.findOne({
                type: 'private',
                participants: { $all: participantObjects.map(p => p._id) },
                $size: 2, // Ensure it has exactly two participants
            })
            .populate({ path: 'participants', select: 'username profilePicture' })
            .populate({ path: 'lastMessage', populate: { path: 'sender', select: 'username profilePicture' } });

            if (existingChat) {
                const otherParticipant = existingChat.participants.find(p => p._id.toString() !== req.user.id);
                const chatName = otherParticipant ? otherParticipant.username : req.user.username;

                 // Calculate unread messages (same as above)
                 let unreadCount = 0;
                 if (existingChat.lastMessage && existingChat.lastMessage.sender.toString() !== req.user.id) {
                     const unreadMessages = await Message.find({
                        chat: existingChat._id,
                        sender: { $ne: req.user.id },
                        readBy: { $ne: req.user.id }
                     });
                     unreadCount = unreadMessages.length;
                 }


                return res.status(200).json({
                    message: 'Private chat already exists',
                    chat: {
                        _id: existingChat._id.toString(),
                        name: chatName,
                        type: existingChat.type,
                        participants: existingChat.participants.map(p => ({
                            _id: p._id.toString(),
                            username: p.username,
                            profilePicture: p.profilePicture,
                        })),
                        lastMessage: existingChat.lastMessage ? {
                            sender: {
                                _id: existingChat.lastMessage.sender._id.toString(),
                                username: existingChat.lastMessage.sender.username,
                                profilePicture: existingChat.lastMessage.sender.profilePicture,
                            },
                            content: existingChat.lastMessage.content,
                            timestamp: existingChat.lastMessage.createdAt.toISOString(),
                            readBy: existingChat.lastMessage.readBy ? existingChat.lastMessage.readBy.map(id => id.toString()) : [],
                        } : null,
                        createdAt: existingChat.createdAt.toISOString(),
                        updatedAt: existingChat.updatedAt.toISOString(),
                        unreadCount: unreadCount,
                        admins: existingChat.admins.map(adminId => adminId.toString()),
                    },
                });
            }
        }

        const newChat = new Chat({
            name: type === 'group' ? name : undefined,
            type,
            participants: participantObjects.map(p => p._id),
            // NEW: Set the creator as the initial admin for group chats
            admins: type === 'group' ? [req.user.id] : [],
        });

        await newChat.save();

        // Populate participants for the response
        await newChat.populate('participants', 'username profilePicture');

        const chatData = {
            _id: newChat._id.toString(),
            name: newChat.name,
            type: newChat.type,
            participants: newChat.participants.map(p => ({
                _id: p._id.toString(),
                username: p.username,
                profilePicture: p.profilePicture,
            })),
            lastMessage: null,
            createdAt: newChat.createdAt.toISOString(),
            updatedAt: newChat.updatedAt.toISOString(),
            unreadCount: 0,
            admins: newChat.admins.map(adminId => adminId.toString()), // NEW: include admins
        };

        // Emit 'chatCreated' event to all participants using req.io
        if (req.io) {
            newChat.participants.forEach(participant => {
                req.io.to(`user_${participant._id.toString()}`).emit('chatCreated', chatData);
            });
        }
        res.status(201).json({ message: 'Chat created successfully', chat: chatData });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// NEW API ENDPOINT: Get group members
// @route   GET /api/chats/:chatId/members
// @desc    Get all members of a specific group chat
// @access  Private
router.get('/:chatId/members', authMiddleware, async (req, res) => {
    try {
        const chat = await Chat.findById(req.params.chatId)
            .populate('participants', 'username profilePicture')
            .populate('admins', '_id'); // Populate admins to get their IDs

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }
        if (chat.type !== 'group') {
            return res.status(400).json({ message: 'This is not a group chat' });
        }

        // Check if current user is a participant
        if (!chat.participants.some(p => p._id.toString() === req.user.id)) {
            return res.status(403).json({ message: 'You are not a member of this chat' });
        }

        const membersData = chat.participants.map(member => ({
            _id: member._id.toString(),
            username: member.username,
            profilePicture: member.profilePicture,
            isAdmin: chat.admins.some(admin => admin._id.toString() === member._id.toString()),
        }));

        res.json(membersData);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// NEW API ENDPOINT: Add members to a group
// @route   POST /api/chats/:chatId/members
// @desc    Add new members to a group chat
// @access  Private (Admin only)
router.post('/:chatId/members', authMiddleware, async (req, res) => {
    const { new_member_ids } = req.body;

    if (!new_member_ids || !Array.isArray(new_member_ids) || new_member_ids.length === 0) {
        return res.status(400).json({ message: 'new_member_ids are required and must be a list' });
    }

    try {
        const chat = await Chat.findById(req.params.chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }
        if (chat.type !== 'group') {
            return res.status(400).json({ message: 'This is not a group chat' });
        }

        // Check if current user is an admin
        if (!isAdmin(chat, req.user.id)) {
            return res.status(403).json({ message: 'Only group admins can add members' });
        }

        const newMembersToAdd = [];
        const addedMembersInfo = [];
        for (const memberId of new_member_ids) {
            // Check if member already exists in the chat
            if (!chat.participants.some(p => p.toString() === memberId)) {
                try {
                    const userToAdd = await User.findById(memberId);
                    if (userToAdd) {
                        newMembersToAdd.push(userToAdd._id);
                        addedMembersInfo.push({
                            _id: userToAdd._id.toString(),
                            username: userToAdd.username,
                            profilePicture: userToAdd.profilePicture,
                            isAdmin: false // New members are not admins by default
                        });
                    } else {
                        console.warn(`User with ID ${memberId} not found, skipping.`);
                    }
                } catch (error) {
                    console.error(`Error finding user ${memberId}:`, error.message);
                }
            }
        }

        if (newMembersToAdd.length === 0) {
            return res.status(200).json({ message: 'No new members to add or all specified users are already members.', added_members: [] });
        }

        chat.participants.push(...newMembersToAdd);
        chat.updatedAt = Date.now(); // Update the updatedAt field
        await chat.save();

        // Populate participants and admins for the socket emission
        await chat.populate('participants', 'username profilePicture');
        await chat.populate('admins', '_id'); // Only need IDs for admins

        const chatDataForSocket = {
            _id: chat._id.toString(),
            name: chat.name,
            type: chat.type,
            participants: chat.participants.map(p => ({
                _id: p._id.toString(),
                username: p.username,
                profilePicture: p.profilePicture,
            })),
            // Create a pseudo last message for the update notification
            lastMessage: {
                sender: { _id: req.user.id, username: req.user.username },
                content: `Members added to the group.`,
                timestamp: new Date().toISOString(),
            },
            createdAt: chat.createdAt.toISOString(),
            updatedAt: chat.updatedAt.toISOString(),
            unreadCount: 0,
            admins: chat.admins.map(admin => admin._id.toString()),
        };

        // Emit to all participants in the chat (including newly added) to update their chat list/details using req.io
        if (req.io) {
            // Join new members to the chat room for future messages
            addedMembersInfo.forEach(member => {
                req.io.to(`user_${member._id}`).socketsJoin(chat._id.toString());
                req.io.to(`user_${member._id}`).emit('chatCreated', chatDataForSocket); // Notify new member about the chat
            });
            req.io.to(chat._id.toString()).emit('group_members_updated', chatDataForSocket);
        }

        res.status(200).json({ message: 'Members added successfully', added_members: addedMembersInfo });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// NEW API ENDPOINT: Remove members from a group
// @route   DELETE /api/chats/:chatId/members/:memberIdToRemove
// @desc    Remove a member from a group chat
// @access  Private (Admin only)
router.delete('/:chatId/members/:memberIdToRemove', authMiddleware, async (req, res) => {
    try {
        const chat = await Chat.findById(req.params.chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }
        if (chat.type !== 'group') {
            return res.status(400).json({ message: 'This is not a group chat' });
        }

        // Check if current user is an admin
        if (!isAdmin(chat, req.user.id)) {
            return res.status(403).json({ message: 'Only group admins can remove members' });
        }

        const memberToRemoveId = req.params.memberIdToRemove;
        const memberToRemove = await User.findById(memberToRemoveId);

        if (!memberToRemove) {
            return res.status(404).json({ message: 'Member to remove not found' });
        }

        // Check if the member to remove is actually in the chat
        const isMemberInChat = chat.participants.some(p => p.toString() === memberToRemoveId);
        if (!isMemberInChat) {
            return res.status(404).json({ message: 'Member not found in this chat' });
        }

        // Prevent removing the last admin
        if (chat.admins.length === 1 && chat.admins[0].toString() === memberToRemoveId) {
            return res.status(400).json({ message: 'Cannot remove the last admin from the group. Assign another admin first.' });
        }

        // Remove member from participants array
        chat.participants = chat.participants.filter(p => p.toString() !== memberToRemoveId);
        // Also remove from admins if they were an admin
        chat.admins = chat.admins.filter(admin => admin.toString() !== memberToRemoveId);

        chat.updatedAt = Date.now(); // Update the updatedAt field
        await chat.save();

        // Populate participants and admins for the socket emission
        await chat.populate('participants', 'username profilePicture');
        await chat.populate('admins', '_id'); // Only need IDs for admins

        const chatDataForSocket = {
            _id: chat._id.toString(),
            name: chat.name,
            type: chat.type,
            participants: chat.participants.map(p => ({
                _id: p._id.toString(),
                username: p.username,
                profilePicture: p.profilePicture,
            })),
            // Create a pseudo last message for the update notification
            lastMessage: {
                sender: { _id: req.user.id, username: req.user.username },
                content: `${memberToRemove.username} was removed from the group.`,
                timestamp: new Date().toISOString(),
            },
            createdAt: chat.createdAt.toISOString(),
            updatedAt: chat.updatedAt.toISOString(),
            unreadCount: 0,
            admins: chat.admins.map(admin => admin._id.toString()),
        };

        if (req.io) { // Use req.io here
            // Notify the removed user to remove the chat from their list
            req.io.to(`user_${memberToRemoveId}`).emit('chatDeleted', chat._id.toString());
            req.io.to(`user_${memberToRemoveId}`).socketsLeave(chat._id.toString()); // Make user leave chat room

            // Notify remaining members in the chat
            req.io.to(chat._id.toString()).emit('group_members_updated', chatDataForSocket);
        }

        res.status(200).json({ message: 'Member removed successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Export the router
module.exports = router;