const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');

// import route handlers
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chats');
const messageRoutes = require('./routes/messages');

// import mongoose models
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');

dotenv.config(); // load environment variables from .env file

// connect to mongodb database
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('mongodb connected'))
    .catch(err => console.error('mongodb connection error:', err));

const app = express();
const server = http.createServer(app); // create an http server using the express app

// middleware to parse incoming json requests
app.use(express.json());

// configure cors (cross-origin resource sharing) for client access
app.use((req, res, next) => {
    res.setHeader('access-control-allow-origin', process.env.CLIENT_URL || 'http://localhost:3000');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'Content-Type, Authorization');
    res.setHeader('access-control-allow-credentials', true);
    // handle preflight requests for cors
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// initialize socket.io server with cors configuration
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// middleware to attach the socket.io instance to the request object
app.use((req, res, next) => {
    req.io = io;
    next();
});

// serve static files from the 'uploads' directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// define api routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);

// root endpoint for api status check
app.get('/', (req, res) => {
    res.send('api is running...');
});

// socket.io authentication middleware
io.use(async (socket, next) => {
    const token = socket.handshake.query.token;
    if (!token) {
        return next(new Error('authentication error: no token provided'));
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = await User.findById(decoded.id).select('-password'); // attach user data to socket
        if (!socket.user) {
            return next(new Error('authentication error: user not found'));
        }
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return next(new Error('authentication error: token expired'));
        }
        next(new Error('authentication error: invalid token'));
    }
});

// socket.io connection handling
io.on('connection', (socket) => {
    console.log(`socket.io: user connected - ${socket.user ? socket.user.username : 'unauthorized'} (${socket.id})`);

    // if user is authenticated, join their personal room
    if (socket.user) {
        socket.join(`user_${socket.user._id.toString()}`);
        console.log(`socket.io: user ${socket.user.username} registered to personal room.`);
    }

    // handler for joining a chat room
    socket.on('join_chat', (chatId) => {
        socket.join(chatId);
        console.log(`socket.io: user ${socket.user ? socket.user.username : 'unknown'} (${socket.id}) joined chat room: ${chatId}`);
    });

    // handler for leaving a chat room
    socket.on('leave_chat', (chatId) => {
        socket.leave(chatId);
        console.log(`socket.io: user ${socket.user ? socket.user.username : 'unknown'} (${socket.id}) left chat room: ${chatId}`);
    });

    // socket.io 'sendmessage' handler
    socket.on('sendMessage', async ({ chatId, content }) => {
        try {
            // basic validation for message data
            if (!chatId || !content || !socket.user || !socket.user._id) {
                socket.emit('messageError', 'chat id, content, and authenticated user are required.');
                console.warn(`[socket error] invalid message data or missing user: chatid=${chatId}, content=${content}, user=${socket.user ? socket.user._id : 'none'}`);
                return;
            }

            // check if chat exists and user is a participant
            const chat = await Chat.findById(chatId);
            if (!chat || !chat.participants.includes(socket.user._id)) {
                socket.emit('messageError', 'not authorized to send message in this chat.');
                console.warn(`[socket error] user ${socket.user.username} tried to send message to unauthorized/non-existent chat ${chatId}.`);
                return;
            }

            // create and save the new message document
            const newMessage = new Message({
                chat: chatId,
                sender: socket.user._id, // assign the objectid of the sender
                content: content,
                readBy: [socket.user._id] // mark as read by the sender upon creation
            });

            const savedMessage = await newMessage.save();
            console.log(`[socket] new message saved with id: ${savedMessage._id}`);

            // update the chat's lastmessage and updatedat fields
            chat.lastMessage = savedMessage._id; // assign savedmessage._id (objectid)
            chat.updatedAt = savedMessage.createdAt; // use message's creation time for chat update
            await chat.save(); // save the updated chat document
            console.log(`[socket] chat ${chatId} updated with lastmessage id: ${savedMessage._id}`);

            // populate sender details for the message before emitting to clients
            const messageToEmit = await Message.findById(savedMessage._id)
                .populate('sender', 'username profilePicture')
                .lean(); // convert to plain js object for efficient emission

            if (!messageToEmit) {
                console.error(`[socket error] failed to find or populate message ${savedMessage._id} after saving.`);
                socket.emit('messageError', 'failed to process message after saving.');
                return;
            }

            // emit the fully populated message to all participants in the chat room
            io.to(chatId).emit('receive_message', messageToEmit);
            console.log(`[socket] emitted 'receive_message' to chat room ${chatId}. message content: ${messageToEmit.content}`);

            // fetch and emit updated chat details for sidebar/chat list updates
            const updatedChatForSidebar = await Chat.findById(chatId)
                .populate('participants', 'username profilePicture')
                .populate({
                    path: 'lastMessage', // populate the lastmessage field
                    populate: {           // then populate its nested 'sender' field
                        path: 'sender',
                        select: 'username profilePicture'
                    }
                })
                .lean(); // use .lean() here too

            if (updatedChatForSidebar) {
                // ensure correct formatting for _id before sending
                updatedChatForSidebar._id = updatedChatForSidebar._id.toString();
                updatedChatForSidebar.participants = updatedChatForSidebar.participants.map(p => ({
                    _id: p._id.toString(),
                    username: p.username,
                    profilePicture: p.profilePicture
                }));
                if (updatedChatForSidebar.lastMessage) {
                    updatedChatForSidebar.lastMessage._id = updatedChatForSidebar.lastMessage._id.toString();
                    if (updatedChatForSidebar.lastMessage.sender) {
                        updatedChatForSidebar.lastMessage.sender._id = updatedChatForSidebar.lastMessage.sender._id.toString();
                    }
                }

                // emit to all participants' personal rooms
                updatedChatForSidebar.participants.forEach(participant => {
                    const participantRoom = `user_${participant._id}`;
                    if (io.sockets.adapter.rooms.has(participantRoom)) {
                        io.to(participantRoom).emit('chatUpdated', updatedChatForSidebar);
                    }
                });
            }

        } catch (error) {
            console.error('error sending message via socket:', error);
            socket.emit('messageError', { message: 'server error during message send.', error: error.message });
        }
    });

    // socket.io 'mark_as_read' handler
    socket.on('mark_as_read', async ({ chatId }) => {
        try {
            if (!chatId || !socket.user || !socket.user._id) {
                console.warn(`[socket] invalid mark_as_read request: chatid=${chatId}, user=${socket.user ? socket.user._id : 'none'}`);
                return;
            }

            const chat = await Chat.findById(chatId);
            if (!chat || !chat.participants.includes(socket.user._id)) {
                console.warn(`[socket] user ${socket.user.username} tried to mark non-existent/unauthorized chat ${chatId} as read.`);
                return;
            }

            // mark messages as read for this user in this chat, only messages not sent by this user
            const updateResult = await Message.updateMany(
                {
                    chat: chatId,
                    sender: { $ne: socket.user._id }, // only mark messages sent by others
                    readBy: { $ne: socket.user._id }   // only messages not already read by this user
                },
                { $addToSet: { readBy: socket.user._id } }
            );
            console.log(`[socket] messages in chat ${chatId} marked as read by ${socket.user.username}. modified count: ${updateResult.modifiedCount}`);

            // fetch the updated chat for sidebar if needed, to reflect changes in unread count on frontend
            const updatedChatForSidebar = await Chat.findById(chatId)
                .populate('participants', 'username profilePicture')
                .populate({
                    path: 'lastMessage',
                    populate: {
                        path: 'sender',
                        select: 'username profilePicture'
                    }
                })
                .lean();

            if (updatedChatForSidebar) {
                // ensure correct formatting for _id before sending
                updatedChatForSidebar._id = updatedChatForSidebar._id.toString();
                updatedChatForSidebar.participants = updatedChatForSidebar.participants.map(p => ({
                    _id: p._id.toString(),
                    username: p.username,
                    profilePicture: p.profilePicture
                }));
                if (updatedChatForSidebar.lastMessage) {
                    updatedChatForSidebar.lastMessage._id = updatedChatForSidebar.lastMessage._id.toString();
                    if (updatedChatForSidebar.lastMessage.sender) {
                        updatedChatForSidebar.lastMessage.sender._id = updatedChatForSidebar.lastMessage.sender._id.toString();
                    }
                }

                // emit 'chatupdated' to all participants' personal rooms
                chat.participants.forEach(participantId => {
                    const participantRoom = `user_${participantId.toString()}`;
                    if (io.sockets.adapter.rooms.has(participantRoom)) {
                        io.to(participantRoom).emit('chatUpdated', updatedChatForSidebar);
                    }
                });
            }

        } catch (error) {
            console.error('error marking messages as read via socket:', error);
            socket.emit('messageError', 'server error marking messages as read.');
        }
    });

    // handler for socket disconnection
    socket.on('disconnect', () => {
        console.log(`socket.io: user disconnected - ${socket.user ? socket.user.username : 'unknown'} (${socket.id})`);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`server running on port ${PORT}`));