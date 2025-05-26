const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const User = require('../models/User'); // Required for populating user data
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');
const mongoose = require('mongoose'); // Make sure this import is present


// Helper function to determine if a user is an admin of a chat
const isAdmin = (chat, userId) => {
    return chat.admins.some(adminId => adminId.toString() === userId.toString());
};


// @route   GET /api/chats
// @desc    Get all chats for the authenticated user
// @access  Private
router.get('/', authMiddleware, async (req, res) => {
    try {
        const chats = await Chat.find({ participants: req.user.id })
            .populate('participants', 'username profilePicture') // Populate all participants
            .populate({
                path: 'lastMessage',
                populate: {
                    path: 'sender',
                    select: 'username profilePicture'
                }
            })
            .sort({ updatedAt: -1 }); // Sort by most recently updated

        // For private chats, find the other participant to display their name/image
        const formattedChats = chats.map(chat => {
            let recipient = null;
            if (chat.type === 'private') {
                recipient = chat.participants.find(p => p._id.toString() !== req.user.id.toString());
                // Handle case where it's a self-chat (only one participant)
                if (!recipient && chat.participants.length === 1 && chat.participants[0]._id.toString() === req.user.id.toString()) {
                     recipient = chat.participants[0]; // Treat self as recipient
                }
            }

            // Calculate unread count for each chat
            let unreadCount = 0;
            if (chat.lastMessage && chat.lastMessage.sender.toString() !== req.user.id.toString()) {
                // If the last message is not from the current user and current user hasn't read it
                if (!chat.lastMessage.readBy.includes(req.user.id)) {
                    unreadCount = 1; // Simplistic count: 1 if last message unread by current user
                                    // For full unread count, you'd query Message collection for unread messages
                }
            }

            return {
                _id: chat._id,
                name: chat.name,
                type: chat.type,
                participants: chat.participants, // Keep full participant list for ChatWindow
                admins: chat.admins,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
                recipient: recipient ? { // Add recipient for private chats
                    _id: recipient._id,
                    username: recipient.username,
                    profilePicture: recipient.profilePicture
                } : null,
                lastMessage: chat.lastMessage ? {
                    _id: chat.lastMessage._id.toString(),
                    sender: {
                        _id: chat.lastMessage.sender._id.toString(),
                        username: chat.lastMessage.sender.username,
                        profilePicture: chat.lastMessage.sender.profilePicture,
                    },
                    content: chat.lastMessage.content,
                    readBy: chat.lastMessage.readBy ? chat.lastMessage.readBy.map(id => id.toString()) : [],
                    createdAt: chat.lastMessage.createdAt.toISOString(),
                    updatedAt: chat.lastMessage.updatedAt.toISOString(),
                } : null,
                unreadCount: unreadCount, // Add unread count
            };
        });

        res.json(formattedChats);
    } catch (err) {
        console.error('Error fetching chats:', err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/chats
// @desc    Create a new chat (private or group)
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
    const { participants, type, name } = req.body; // participants should be an array of user IDs

    if (!participants || !Array.isArray(participants) || participants.length < 1) {
        return res.status(400).json({ message: 'Participants array is required.' });
    }
    if (type === 'group' && (!name || name.trim() === '')) {
        return res.status(400).json({ message: 'Group chat requires a name.' });
    }
    if (!['private', 'group'].includes(type)) {
        return res.status(400).json({ message: 'Invalid chat type.' });
    }

    // Ensure all participant IDs are valid ObjectIDs
    if (!participants.every(id => mongoose.Types.ObjectId.isValid(id))) {
        return res.status(400).json({ message: 'Invalid participant ID format.' });
    }

    // Ensure current user is in participants list
    if (!participants.includes(req.user.id)) {
        participants.push(req.user.id);
    }

    try {
        let chat;
        if (type === 'private') {
            // For private chats, ensure only 2 participants and avoid duplicates
            if (participants.length !== 2) {
                return res.status(400).json({ message: 'Private chat must have exactly two participants.' });
            }

            // Check if a private chat between these two users already exists
            chat = await Chat.findOne({
                type: 'private',
                participants: {
                    $size: 2,
                    $all: participants.map(id => new mongoose.Types.ObjectId(id))
                }
            });

            if (chat) {
                // If chat exists, just return it
                await chat.populate('participants', 'username profilePicture');
                return res.status(200).json({ message: 'Chat already exists.', chat });
            }

            // Create new private chat
            chat = new Chat({ participants, type });
        } else { // type === 'group'
            // For group chats, the creator is typically an admin
            const admins = [req.user.id];
            chat = new Chat({ participants, type, name, admins });
        }

        const savedChat = await chat.save();
        await savedChat.populate('participants', 'username profilePicture'); // Populate for response and socket

        // Emit 'chatCreated' event to all participants
        if (req.io) {
            savedChat.participants.forEach(participant => {
                req.io.to(`user_${participant._id.toString()}`).emit('chatCreated', {
                    _id: savedChat._id.toString(),
                    name: savedChat.name,
                    type: savedChat.type,
                    participants: savedChat.participants.map(p => ({
                        _id: p._id.toString(),
                        username: p.username,
                        profilePicture: p.profilePicture
                })),
                    admins: savedChat.admins.map(id => id.toString()),
                    createdAt: savedChat.createdAt.toISOString(),
                    updatedAt: savedChat.updatedAt.toISOString(),
                    lastMessage: null, // New chat, no last message yet
                    unreadCount: 0, // New chat, unread count is 0
                });
            });
        }

        res.status(201).json({ message: 'Chat created successfully', chat: savedChat });
    } catch (err) {
        console.error('Error creating chat:', err.message);
        res.status(500).send('Server Error');
    }
});


// @route   GET /api/chats/:chatId/messages
// @desc    Get all messages for a specific chat
// @access  Private
router.get('/:chatId/messages', authMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.chatId)) {
            return res.status(400).json({ message: 'Invalid chat ID format.' });
        }

        const chat = await Chat.findById(req.params.chatId);

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        // Ensure the current user is a participant of this chat
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
        chat.updatedAt = Date.now(); // Update chat's updated timestamp
        await chat.save();

        // IMPORTANT: Populate sender details for the socket emission
        await savedMessage.populate('sender', 'username profilePicture');

        // Prepare message data for frontend (ensure all necessary fields are included)
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

        // --- BACKEND SOCKET EMIT LOGS (from previous debugging step) ---
        console.log(`[BACKEND SOCKET] Attempting to emit 'receive_message' for chat ID: ${chatId.toString()}`);
        console.log('[BACKEND SOCKET] Message data being emitted:', messageData);
        if (!req.io) {
            console.error('[BACKEND SOCKET ERROR] req.io is undefined or null! Socket.IO server not attached to request object.');
        } else {
            console.log(`[BACKEND SOCKET] Sockets in room "${chatId.toString()}":`, req.io.sockets.adapter.rooms.get(chatId.toString()) ? req.io.sockets.adapter.rooms.get(chatId.toString()).size : 0);
            req.io.to(chatId.toString()).emit('receive_message', messageData);
            console.log('[BACKEND SOCKET] Emitted "receive_message" successfully.');
        }
        // --- END BACKEND SOCKET EMIT LOGS ---


        // Also emit 'chatUpdated' to all participants so their chat list updates
        if (req.io) {
            chat.participants.forEach(participantId => {
                req.io.to(`user_${participantId.toString()}`).emit('chatUpdated', {
                    _id: chat._id.toString(),
                    name: chat.name,
                    type: chat.type,
                    participants: chat.participants, // Keep participants for correct rendering
                    admins: chat.admins, // Include admins for client-side checks
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

        res.status(201).json(messageData); // Send response back to sender's client
    } catch (err) {
        console.error('Error sending message:', err.message);
        res.status(500).send('Server Error');
    }
});


// @route   POST /api/chats/:chatId/markAsRead
// @desc    Mark all unread messages in a chat as read by the authenticated user
// @access  Private
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
            { new: true } // This option is for findOneAndUpdate, not updateMany. It won't hurt, but it's not effective here.
        );

        // Optionally, emit a socket event to update unread counts on other devices/users
        if (req.io) {
             // Emit to the user who just marked messages as read, to update their unread count badge
             req.io.to(`user_${userId.toString()}`).emit('chatRead', { chatId: chatId.toString() });

             // The following line would be around line 183 if no extra lines were added.
             // If you have `await newMessage.populate('sender', 'username profilePicture');`
             // or similar here, that's what caused the ReferenceError.
             // It should NOT be here.
        }

        res.status(200).json({ message: 'Messages marked as read successfully', updatedCount: result.modifiedCount });

    } catch (err) {
        console.error('Error marking messages as read:', err.message);
        res.status(500).send('Server Error');
    }
});


// @route   GET /api/chats/:chatId/members
// @desc    Get all members of a specific group chat
// @access  Private (only for chat participants)
router.get('/:chatId/members', authMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.chatId)) {
            return res.status(400).json({ message: 'Invalid chat ID format.' });
        }

        const chat = await Chat.findById(req.params.chatId)
                               .populate('participants', 'username profilePicture');

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        if (chat.type !== 'group') {
            return res.status(400).json({ message: 'This endpoint is only for group chats.' });
        }

        // Ensure current user is a participant
        if (!chat.participants.some(p => p._id.toString() === req.user.id.toString())) {
            return res.status(403).json({ message: 'Not authorized to view members of this chat.' });
        }

        // Add isAdmin flag to each member
        const membersWithAdminStatus = chat.participants.map(p => ({
            _id: p._id.toString(),
            username: p.username,
            profilePicture: p.profilePicture,
            isAdmin: chat.admins.some(adminId => adminId.toString() === p._id.toString())
        }));

        res.status(200).json(membersWithAdminStatus);
    } catch (err) {
        console.error('Error fetching group members:', err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/chats/:chatId/members
// @desc    Add new members to a group chat
// @access  Private (only for chat admins)
router.post('/:chatId/members', authMiddleware, async (req, res) => {
    const { new_member_ids } = req.body;
    const chatId = req.params.chatId;

    if (!new_member_ids || !Array.isArray(new_member_ids) || new_member_ids.length === 0) {
        return res.status(400).json({ message: 'New member IDs array is required.' });
    }
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({ message: 'Invalid chat ID format.' });
    }
    if (!new_member_ids.every(id => mongoose.Types.ObjectId.isValid(id))) {
        return res.status(400).json({ message: 'Invalid new member ID format.' });
    }

    try {
        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found.' });
        }
        if (chat.type !== 'group') {
            return res.status(400).json({ message: 'Members can only be added to group chats.' });
        }
        if (!isAdmin(chat, req.user.id)) {
            return res.status(403).json({ message: 'Only chat admins can add members.' });
        }

        const currentParticipantIds = new Set(chat.participants.map(id => id.toString()));
        const uniqueNewMemberIds = new_member_ids.filter(id => !currentParticipantIds.has(id.toString()));

        if (uniqueNewMemberIds.length === 0) {
            return res.status(200).json({ message: 'All provided users are already members.', chat });
        }

        // Add unique new members to the participants array
        chat.participants.push(...uniqueNewMemberIds);
        chat.updatedAt = Date.now();
        await chat.save();

        // Populate participants for the response and socket emit
        await chat.populate('participants', 'username profilePicture');

        // Emit update to all affected users (new members and existing members)
        if (req.io) {
            const addedUsers = chat.participants.filter(p => uniqueNewMemberIds.includes(p._id.toString()));
            const messageContent = `${req.user.username} added ${addedUsers.map(u => u.username).join(', ')} to the group.`;

            // Create a system message for the chat about members being added
            const systemMessage = new Message({
                chat: chatId,
                sender: req.user.id, // Or a designated system user ID
                content: messageContent,
                isSystemMessage: true, // Mark as system message
            });
            await systemMessage.save();
            await systemMessage.populate('sender', 'username profilePicture'); // Populate sender for socket

            const systemMessageData = {
                _id: systemMessage._id.toString(),
                chat: systemMessage.chat.toString(),
                sender: {
                    _id: systemMessage.sender._id.toString(),
                    username: systemMessage.sender.username,
                    profilePicture: systemMessage.sender.profilePicture || null,
                },
                content: systemMessage.content,
                isSystemMessage: true,
                createdAt: systemMessage.createdAt.toISOString(),
                updatedAt: systemMessage.updatedAt.toISOString(),
            };

            // Emit the system message to the chat room
            req.io.to(chatId.toString()).emit('receive_message', systemMessageData);

            // Emit 'chatUpdated' to all participants (old and new)
            // This is crucial to update the chat list and participants list
            chat.participants.forEach(participant => {
                req.io.to(`user_${participant._id.toString()}`).emit('chatUpdated', {
                    _id: chat._id.toString(),
                    name: chat.name,
                    type: chat.type,
                    participants: chat.participants.map(p => ({
                        _id: p._id.toString(),
                        username: p.username,
                        profilePicture: p.profilePicture
                    })),
                    admins: chat.admins.map(id => id.toString()),
                    lastMessage: { // Update last message to the system message
                         sender: { _id: systemMessage.sender._id.toString(), username: systemMessage.sender.username, profilePicture: systemMessage.sender.profilePicture },
                         content: systemMessage.content,
                         timestamp: systemMessage.createdAt.toISOString()
                    },
                    updatedAt: chat.updatedAt.toISOString(),
                });
            });
        }

        res.status(200).json({ message: 'Members added successfully.', chat });
    } catch (err) {
        console.error('Error adding members:', err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/chats/:chatId/members/:memberIdToRemove
// @desc    Remove a member from a group chat
// @access  Private (only for chat admins)
router.delete('/:chatId/members/:memberIdToRemove', authMiddleware, async (req, res) => {
    const { chatId, memberIdToRemove } = req.params;

    if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(memberIdToRemove)) {
        return res.status(400).json({ message: 'Invalid ID format.' });
    }

    try {
        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({ message: 'Chat not found.' });
        }
        if (chat.type !== 'group') {
            return res.status(400).json({ message: 'Members can only be removed from group chats.' });
        }
        if (!isAdmin(chat, req.user.id)) {
            return res.status(403).json({ message: 'Only chat admins can remove members.' });
        }

        // Prevent admin from removing themselves unless they are the only admin
        if (isAdmin(chat, memberIdToRemove) && chat.admins.length === 1 && chat.admins[0].toString() === memberIdToRemove.toString()) {
            return res.status(403).json({ message: 'Cannot remove the last admin from the group. Transfer admin rights first or delete the chat.' });
        }

        const initialParticipantsCount = chat.participants.length;
        chat.participants = chat.participants.filter(id => id.toString() !== memberIdToRemove.toString());
        chat.admins = chat.admins.filter(id => id.toString() !== memberIdToRemove.toString()); // Remove from admins if they were one

        if (chat.participants.length === initialParticipantsCount) {
             return res.status(404).json({ message: 'Member not found in this chat.' });
        }

        // If the chat becomes empty after removal, you might want to delete it or keep it
        // For simplicity, let's just save for now. If participants array is empty, it will be an empty chat.
        // Optional: if (chat.participants.length === 0) await Chat.findByIdAndDelete(chatId);

        chat.updatedAt = Date.now();
        await chat.save();

        await chat.populate('participants', 'username profilePicture'); // Populate for response and socket

        // Emit update to all affected users
        if (req.io) {
            const removedUser = await User.findById(memberIdToRemove); // Get user info for system message
            const messageContent = `${req.user.username} removed ${removedUser ? removedUser.username : 'a user'} from the group.`;

            // Create a system message for the chat about members being removed
            const systemMessage = new Message({
                chat: chatId,
                sender: req.user.id, // Or a designated system user ID
                content: messageContent,
                isSystemMessage: true, // Mark as system message
            });
            await systemMessage.save();
            await systemMessage.populate('sender', 'username profilePicture');

            const systemMessageData = {
                _id: systemMessage._id.toString(),
                chat: systemMessage.chat.toString(),
                sender: {
                    _id: systemMessage.sender._id.toString(),
                    username: systemMessage.sender.username,
                    profilePicture: systemMessage.sender.profilePicture || null,
                },
                content: systemMessage.content,
                isSystemMessage: true,
                createdAt: systemMessage.createdAt.toISOString(),
                updatedAt: systemMessage.updatedAt.toISOString(),
            };

            // Emit the system message to the chat room
            req.io.to(chatId.toString()).emit('receive_message', systemMessageData);

            // Emit 'chatUpdated' to remaining participants and the removed user
            // For the removed user, emit 'chatDeleted' to remove it from their list
            const allAffectedUsers = [...chat.participants.map(p => p._id.toString()), memberIdToRemove];

            allAffectedUsers.forEach(participantId => {
                if (participantId === memberIdToRemove) {
                    req.io.to(`user_${participantId}`).emit('chatDeleted', chatId.toString());
                } else {
                    req.io.to(`user_${participantId}`).emit('chatUpdated', {
                        _id: chat._id.toString(),
                        name: chat.name,
                        type: chat.type,
                        participants: chat.participants.map(p => ({
                            _id: p._id.toString(),
                            username: p.username,
                            profilePicture: p.profilePicture
                        })),
                        admins: chat.admins.map(id => id.toString()),
                        lastMessage: { // Update last message to the system message
                             sender: { _id: systemMessage.sender._id.toString(), username: systemMessage.sender.username, profilePicture: systemMessage.sender.profilePicture },
                             content: systemMessage.content,
                             timestamp: systemMessage.createdAt.toISOString()
                        },
                        updatedAt: chat.updatedAt.toISOString(),
                    });
                }
            });

             // Also, if the removed user was in the chat room, make their socket leave
             if (req.io.sockets.adapter.rooms.get(chatId.toString())) {
                 req.io.sockets.adapter.rooms.get(chatId.toString()).forEach(socketId => {
                     const s = req.io.sockets.sockets.get(socketId);
                     if (s && s.userId === memberIdToRemove) { // Assuming you set socket.userId on connect
                         s.leave(chatId.toString());
                     }
                 });
             }
        }

        res.status(200).json({ message: 'Member removed successfully.', chat });
    } catch (err) {
        console.error('Error removing member:', err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;