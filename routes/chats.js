const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('only images (jpg, jpeg, png, gif) and videos (mp4, mov, avi, webm) are allowed!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 1024 * 1024 * 50
    }
});

const isAdmin = (chat, userId) => {
    if (!Array.isArray(chat.admins)) {
        return false;
    }
    return chat.admins.some(adminId => adminId && adminId.toString() === userId.toString());
};


router.get('/', authMiddleware, async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ message: 'unauthorized: user not authenticated.' });
    }

    try {
        let chats;
        try {
            chats = await Chat.find({ participants: req.user.id })
                .populate('participants', 'username profilePicture')
                .populate({
                    path: 'lastMessage',
                    populate: {
                        path: 'sender',
                        select: 'username profilePicture',
                    }
                })
                .sort({ updatedAt: -1 });

        } catch (queryError) {
            throw new Error(`failed to fetch chats from database: ${queryError.message}`);
        }

        if (!Array.isArray(chats)) {
            return res.status(500).json({ message: 'server error: chats data is malformed after query.' });
        }

        const formattedChats = chats.map(chat => {
            if (!chat || !chat._id) {
                return null;
            }

            let recipient = null;
            if (chat.type === 'private') {
                if (Array.isArray(chat.participants)) {
                    recipient = chat.participants.find(p => p?._id?.toString() !== req.user.id.toString());
                    if (!recipient && chat.participants.length === 1 && chat.participants[0] && chat.participants[0]._id?.toString() === req.user.id.toString()) {
                        recipient = chat.participants[0];
                    }
                }
            }

            let unreadCount = 0;
            if (chat.lastMessage) {
                if (chat.lastMessage.sender) {
                    if (chat.lastMessage.sender._id) {
                        if (chat.lastMessage.sender._id.toString() !== req.user.id.toString()) {
                            if (Array.isArray(chat.lastMessage.readBy) && !chat.lastMessage.readBy.includes(req.user.id)) {
                                unreadCount = 1;
                            }
                        }
                    }
                }
            }

            return {
                _id: chat._id?.toString(),
                name: chat.name,
                type: chat.type,
                participants: Array.isArray(chat.participants) ? chat.participants.map(p => ({
                    _id: p?._id?.toString(),
                    username: p?.username,
                    profilePicture: p?.profilePicture || null,
                })).filter(p => p._id) : [],
                admins: Array.isArray(chat.admins) ? chat.admins.map(a => a?.toString()).filter(Boolean) : [],
                createdAt: chat.createdAt?.toISOString(),
                updatedAt: chat.updatedAt?.toISOString(),
                recipient: recipient ? {
                    _id: recipient._id?.toString(),
                    username: recipient.username,
                    profilePicture: recipient.profilePicture
                } : null,
                lastMessage: chat.lastMessage ? {
                    _id: chat.lastMessage._id?.toString(),
                    sender: chat.lastMessage.sender ? {
                        _id: chat.lastMessage.sender?._id?.toString(),
                        username: chat.lastMessage.sender?.username,
                        profilePicture: chat.lastMessage.sender?.profilePicture || null,
                    } : null,
                    content: chat.lastMessage.content,
                    mediaUrl: chat.lastMessage.mediaUrl,
                    mediaType: chat.lastMessage.mediaType,
                    readBy: Array.isArray(chat.lastMessage.readBy) ? chat.lastMessage.readBy.map(id => id?.toString()).filter(Boolean) : [],
                    createdAt: chat.lastMessage.createdAt?.toISOString(),
                    updatedAt: chat.lastMessage.updatedAt?.toISOString(),
                } : null,
                unreadCount: unreadCount,
            };
        }).filter(Boolean);

        res.json(formattedChats);
    } catch (err) {
        res.status(500).json({ message: 'server error fetching chats.', error: err.message, stack: process.env.NODE_ENV === 'development' ? err.stack : undefined });
    }
});


router.post('/', authMiddleware, async (req, res) => {
    const { participants, type, name } = req.body;

    if (!participants || !Array.isArray(participants) || participants.length < 1) {
        return res.status(400).json({ message: 'participants array is required.' });
    }
    if (type === 'group' && (!name || name.trim() === '')) {
        return res.status(400).json({ message: 'group chat requires a name.' });
    }
    if (!['private', 'group'].includes(type)) {
        return res.status(400).json({ message: 'invalid chat type.' });
    }

    if (!participants.every(id => mongoose.Types.ObjectId.isValid(id))) {
        return res.status(400).json({ message: 'invalid participant id format.' });
    }

    if (!participants.includes(req.user.id)) {
        participants.push(req.user.id);
    }

    try {
        let chat;
        if (type === 'private') {
            if (participants.length !== 2) {
                return res.status(400).json({ message: 'private chat must have exactly two participants.' });
            }

            chat = await Chat.findOne({
                type: 'private',
                participants: {
                    $size: 2,
                    $all: participants.map(id => new mongoose.Types.ObjectId(id))
                }
            });

            if (chat) {
                await chat.populate('participants', 'username profilePicture');
                return res.status(200).json({ message: 'chat already exists.', chat });
            }

            chat = new Chat({ participants, type });
        } else {
            const admins = [req.user.id];
            chat = new Chat({ participants, type, name, admins });
        }

        const savedChat = await chat.save();
        await savedChat.populate('participants', 'username profilePicture');

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
                    lastMessage: null,
                    unreadCount: 0,
                });
            });
        }

        res.status(201).json({ message: 'chat created successfully', chat: savedChat });
    } catch (err) {
        res.status(500).json({ message: 'server error creating chat.', error: err.message });
    }
});


router.get('/:chatId/messages', authMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.chatId)) {
            return res.status(400).json({ message: 'invalid chat id format.' });
        }

        const chat = await Chat.findById(req.params.chatId);

        if (!chat) {
            return res.status(404).json({ message: 'chat not found' });
        }

        if (!chat.participants.some(p => p.toString() === req.user.id.toString())) {
            return res.status(403).json({ message: 'not authorized to view messages in this chat' });
        }

        const messages = await Message.find({ chat: req.params.chatId })
            .populate('sender', 'username profilePicture')
            .sort({ createdAt: 1 });

        res.status(200).json(messages);
    } catch (err) {
        res.status(500).json({ message: 'server error fetching messages.', error: err.message });
    }
});


router.post('/:chatId/messages', authMiddleware, upload.single('media'), async (req, res) => {
    const { content } = req.body;
    const chatId = req.params.chatId;
    const senderId = req.user.id;
    const file = req.file;

    let mediaUrl = null;
    let mediaType = null;

    if (file) {
        mediaUrl = `/uploads/${file.filename}`;

        if (file.mimetype.startsWith('image/')) {
            mediaType = file.mimetype.includes('gif') ? 'gif' : 'image';
        } else if (file.mimetype.startsWith('video/')) {
            mediaType = 'video';
        }
    }

    if (!content && !file) {
        return res.status(400).json({ message: 'message must have either content or an attachment.' });
    }

    if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({ message: 'invalid chat id format' });
    }

    try {
        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({ message: 'chat not found' });
        }

        if (!chat.participants.map(p => p.toString()).includes(senderId.toString())) {
            return res.status(403).json({ message: 'not authorized to send messages to this chat' });
        }

        const newMessage = new Message({
            chat: chatId,
            sender: senderId,
            content,
            mediaUrl,
            mediaType
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
            mediaUrl: savedMessage.mediaUrl,
            mediaType: savedMessage.mediaType,
            readBy: savedMessage.readBy ? savedMessage.readBy.map(id => id.toString()) : [],
            createdAt: savedMessage.createdAt.toISOString(),
            updatedAt: savedMessage.updatedAt.toISOString(),
        };

        if (req.io) {
            req.io.to(chatId.toString()).emit('receive_message', messageData);
        }

        if (req.io) {
            chat.participants.forEach(participantId => {
                req.io.to(`user_${participantId.toString()}`).emit('chatUpdated', {
                    _id: chat._id.toString(),
                    name: chat.name,
                    type: chat.type,
                    participants: chat.participants,
                    admins: chat.admins,
                    lastMessage: {
                        sender: {
                            _id: messageData.sender._id,
                            username: messageData.sender.username,
                            profilePicture: messageData.sender.profilePicture
                        },
                        content: messageData.content,
                        mediaUrl: messageData.mediaUrl,
                        mediaType: messageData.mediaType,
                        timestamp: messageData.createdAt
                    },
                    updatedAt: chat.updatedAt.toISOString(),
                });
            });
        }

        res.status(201).json(messageData);
    } catch (err) {
        res.status(500).json({ message: 'server error sending message.', error: err.message });
    }
});


router.post('/:chatId/markAsRead', authMiddleware, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const userId = req.user.id;

        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: 'invalid chat id format' });
        }

        const chat = await Chat.findById(chatId);
        if (!chat) {
            return res.status(404).json({ message: 'chat not found' });
        }

        if (!chat.participants.includes(userId)) {
            return res.status(403).json({ message: 'not authorized to mark messages in this chat' });
        }

        const result = await Message.updateMany(
            {
                chat: chatId,
                sender: { $ne: userId },
                readBy: { $ne: userId }
            },
            {
                $addToSet: { readBy: userId }
            },
        );

        if (req.io) {
            req.io.to(`user_${userId.toString()}`).emit('chatRead', { chatId: chatId.toString() });
        }

        res.status(200).json({ message: 'messages marked as read successfully', updatedCount: result.modifiedCount });

    } catch (err) {
        res.status(500).json({ message: 'server error marking messages as read.', error: err.message });
    }
});


router.get('/:chatId/members', authMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.chatId)) {
            return res.status(400).json({ message: 'invalid chat id format.' });
        }

        const chat = await Chat.findById(req.params.chatId)
            .populate('participants', 'username profilePicture');

        if (!chat) {
            return res.status(404).json({ message: 'chat not found' });
        }

        if (chat.type !== 'group') {
            return res.status(400).json({ message: 'this endpoint is only for group chats.' });
        }

        if (!chat.participants.some(p => p._id.toString() === req.user.id.toString())) {
            return res.status(403).json({ message: 'not authorized to view members of this chat.' });
        }

        const membersWithAdminStatus = chat.participants.map(p => ({
            _id: p._id.toString(),
            username: p.username,
            profilePicture: p.profilePicture,
            isAdmin: chat.admins.some(adminId => adminId && adminId.toString() === p._id.toString())
        }));

        res.status(200).json(membersWithAdminStatus);
    } catch (err) {
        res.status(500).json({ message: 'server error fetching group members.', error: err.message });
    }
});

router.post('/:chatId/members', authMiddleware, async (req, res) => {
    const { new_member_ids } = req.body;
    const chatId = req.params.chatId;

    if (!new_member_ids || !Array.isArray(new_member_ids) || new_member_ids.length === 0) {
        return res.status(400).json({ message: 'new member ids array is required.' });
    }
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({ message: 'invalid chat id format.' });
    }
    if (!new_member_ids.every(id => mongoose.Types.ObjectId.isValid(id))) {
        return res.status(400).json({ message: 'invalid new member id format.' });
    }

    try {
        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({ message: 'chat not found.' });
        }
        if (chat.type !== 'group') {
            return res.status(400).json({ message: 'members can only be added to group chats.' });
        }
        if (!isAdmin(chat, req.user.id)) {
            return res.status(403).json({ message: 'only chat admins can add members.' });
        }

        const currentParticipantIds = new Set(chat.participants.map(id => id.toString()));
        const uniqueNewMemberIds = new_member_ids.filter(id => !currentParticipantIds.has(id.toString()));

        if (uniqueNewMemberIds.length === 0) {
            return res.status(200).json({ message: 'all provided users are already members.', chat });
        }

        chat.participants.push(...uniqueNewMemberIds);
        chat.updatedAt = Date.now();
        await chat.save();

        await chat.populate('participants', 'username profilePicture');

        if (req.io) {
            const addedUsers = await User.find({ _id: { $in: uniqueNewMemberIds } });
            const messageContent = `${req.user.username} added ${addedUsers.map(u => u.username).join(', ')} to the group.`;

            const systemMessage = new Message({
                chat: chatId,
                sender: req.user.id,
                content: messageContent,
                isSystemMessage: true,
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

            req.io.to(chatId.toString()).emit('receive_message', systemMessageData);

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
                    lastMessage: {
                        sender: { _id: systemMessage.sender._id.toString(), username: systemMessage.sender.username, profilePicture: systemMessage.sender.profilePicture },
                        content: systemMessage.content,
                        timestamp: systemMessage.createdAt.toISOString()
                    },
                    updatedAt: chat.updatedAt.toISOString(),
                });
            });
        }

        res.status(200).json({ message: 'members added successfully.', chat });
    } catch (err) {
        res.status(500).json({ message: 'server error adding members.', error: err.message });
    }
});

router.delete('/:chatId/members/:memberIdToRemove', authMiddleware, async (req, res) => {
    const { chatId, memberIdToRemove } = req.params;

    if (!mongoose.Types.ObjectId.isValid(chatId) || !mongoose.Types.ObjectId.isValid(memberIdToRemove)) {
        return res.status(400).json({ message: 'invalid id format.' });
    }

    try {
        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({ message: 'chat not found.' });
        }
        if (chat.type !== 'group') {
            return res.status(400).json({ message: 'members can only be removed from group chats.' });
        }
        if (!isAdmin(chat, req.user.id)) {
            return res.status(403).json({ message: 'only chat admins can remove members.' });
        }

        if (isAdmin(chat, memberIdToRemove) && chat.admins.length === 1 && chat.admins[0].toString() === memberIdToRemove.toString()) {
            return res.status(403).json({ message: 'cannot remove the last admin from the group. transfer admin rights first or delete the chat.' });
        }

        const initialParticipantsCount = chat.participants.length;
        chat.participants = chat.participants.filter(id => id.toString() !== memberIdToRemove.toString());
        chat.admins = chat.admins.filter(id => id.toString() !== memberIdToRemove.toString());

        if (chat.participants.length === initialParticipantsCount) {
            return res.status(404).json({ message: 'member not found in this chat.' });
        }

        chat.updatedAt = Date.now();
        await chat.save();

        await chat.populate('participants', 'username profilePicture');

        if (req.io) {
            const removedUser = await User.findById(memberIdToRemove);
            const messageContent = `${req.user.username} removed ${removedUser ? removedUser.username : 'a user'} from the group.`;

            const systemMessage = new Message({
                chat: chatId,
                sender: req.user.id,
                content: messageContent,
                isSystemMessage: true,
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

            req.io.to(chatId.toString()).emit('receive_message', systemMessageData);

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
                    lastMessage: {
                        sender: { _id: systemMessage.sender._id.toString(), username: systemMessage.sender.username, profilePicture: systemMessage.sender.profilePicture },
                        content: systemMessage.content,
                        timestamp: systemMessage.createdAt.toISOString()
                    },
                    updatedAt: chat.updatedAt.toISOString(),
                });
            });

            req.io.to(`user_${memberIdToRemove}`).emit('chatRemoved', { chatId: chatId.toString() });
        }

        res.status(200).json({ message: 'member removed successfully.', chat });
    } catch (err) {
        res.status(500).json({ message: 'server error removing member.', error: err.message });
    }
});

router.delete('/:chatId', authMiddleware, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({ message: 'invalid chat id format.' });
    }

    try {
        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({ message: 'chat not found.' });
        }

        if (chat.type === 'group') {
            if (!isAdmin(chat, userId)) {
                return res.status(403).json({ message: 'only chat admins can delete group chats.' });
            }
        } else {
            if (!chat.participants.includes(userId)) {
                return res.status(403).json({ message: 'not authorized to delete this chat.' });
            }
            chat.participants = chat.participants.filter(p => p.toString() !== userId.toString());
        }

        if (chat.type === 'group' || (chat.type === 'private' && chat.participants.length === 0)) {
            await Message.deleteMany({ chat: chatId });
            await Chat.deleteOne({ _id: chatId });

            if (req.io) {
                const allParticipants = chat.participants.map(p => p.toString());
                if (chat.type === 'group') {
                    chat.participants.forEach(participantId => {
                        req.io.to(`user_${participantId.toString()}`).emit('chatDeleted', { chatId: chatId.toString() });
                    });
                } else if (chat.type === 'private') {
                }
            }

            return res.status(200).json({ message: 'chat and its messages deleted successfully.' });
        } else if (chat.type === 'private' && chat.participants.length > 0) {
            await chat.save();
            if (req.io) {
                req.io.to(`user_${userId.toString()}`).emit('chatRemoved', { chatId: chatId.toString() });
                const remainingParticipantId = chat.participants[0].toString();
                req.io.to(`user_${remainingParticipantId}`).emit('chatUpdated', {
                    _id: chat._id.toString(),
                    name: chat.name,
                    type: chat.type,
                    participants: chat.participants,
                    admins: chat.admins,
                    lastMessage: chat.lastMessage,
                    updatedAt: chat.updatedAt.toISOString(),
                });
            }
            return res.status(200).json({ message: 'successfully left chat.' });
        }

    } catch (err) {
        res.status(500).json({ message: 'server error deleting/leaving chat.', error: err.message });
    }
});


router.post('/:chatId/leave', authMiddleware, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({ message: 'invalid chat id format.' });
    }

    try {
        const chat = await Chat.findById(chatId);

        if (!chat) {
            return res.status(404).json({ message: 'chat not found.' });
        }

        if (chat.type === 'private') {
            return res.status(400).json({ message: 'use the delete chat endpoint for private chats.' });
        }

        if (!chat.participants.some(p => p.toString() === userId.toString())) {
            return res.status(400).json({ message: 'you are not a participant of this chat.' });
        }

        if (isAdmin(chat, userId) && chat.admins.length === 1 && chat.admins[0].toString() === userId.toString()) {
            return res.status(403).json({ message: 'cannot leave: you are the last admin. transfer admin rights or delete the group.' });
        }

        const initialParticipantsCount = chat.participants.length;

        chat.participants = chat.participants.filter(p => p.toString() !== userId.toString());
        chat.admins = chat.admins.filter(a => a.toString() !== userId.toString());

        if (chat.participants.length === initialParticipantsCount) {
            return res.status(404).json({ message: 'user not found in this chat.' });
        }

        chat.updatedAt = Date.now();
        await chat.save();

        await chat.populate('participants', 'username profilePicture');

        if (req.io) {
            const leavingUser = await User.findById(userId);
            const messageContent = `${leavingUser ? leavingUser.username : 'a user'} has left the group.`;

            const systemMessage = new Message({
                chat: chatId,
                sender: userId,
                content: messageContent,
                isSystemMessage: true,
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

            req.io.to(chatId.toString()).emit('receive_message', systemMessageData);

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
                    lastMessage: {
                        sender: { _id: systemMessage.sender._id.toString(), username: systemMessage.sender.username, profilePicture: systemMessage.sender.profilePicture },
                        content: systemMessage.content,
                        timestamp: systemMessage.createdAt.toISOString()
                    },
                    updatedAt: chat.updatedAt.toISOString(),
                });
            });

            req.io.to(`user_${userId.toString()}`).emit('chatRemoved', { chatId: chatId.toString() });
        }

        res.status(200).json({ message: 'successfully left chat.' });
    } catch (err) {
        res.status(500).json({ message: 'server error leaving chat.', error: err.message });
    }
});


module.exports = router;