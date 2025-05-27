const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chats');
const messageRoutes = require('./routes/messages'); // Make sure this route exists and handles messages

// Import Models
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message'); // Make sure this model exists and is correct

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

const app = express();
const server = http.createServer(app); // Create HTTP server from express app

// Middleware to parse JSON bodies
app.use(express.json());

// CORS setup (important for frontend communication)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', true);
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ************************************************************
// *** Socket.IO Setup and io.use middleware ***
// ************************************************************

const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Middleware to attach io to req (for Express routes that need to emit events)
app.use((req, res, next) => {
    req.io = io;
    next();
});

// ************************************************************
// *** End of Socket.IO setup for Express routes ***
// ************************************************************

// Define API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes); // Assuming you have message-specific routes

// Basic root route for testing server status
app.get('/', (req, res) => {
    res.send('API is running...');
});

// Socket.IO Authentication Middleware
io.use(async (socket, next) => {
    const token = socket.handshake.query.token;
    if (!token) {
        return next(new Error('Authentication error: No token provided'));
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = await User.findById(decoded.id).select('-password');
        if (!socket.user) {
            return next(new Error('Authentication error: User not found'));
        }
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return next(new Error('Authentication error: Token expired'));
        }
        next(new Error('Authentication error: Invalid token'));
    }
});

io.on('connection', (socket) => {
    console.log(`Socket.IO: User connected - ${socket.user ? socket.user.username : 'Unauthorized'} (${socket.id})`);

    if (socket.user) {
        socket.join(`user_${socket.user._id.toString()}`); // User's personal room
        console.log(`Socket.IO: User ${socket.user.username} registered to personal room.`);
    }

    socket.on('join_chat', (chatId) => {
        socket.join(chatId);
        console.log(`Socket.IO: User ${socket.user ? socket.user.username : 'Unknown'} (${socket.id}) joined chat room: ${chatId}`);
    });

    socket.on('leave_chat', (chatId) => {
        socket.leave(chatId);
        console.log(`Socket.IO: User ${socket.user ? socket.user.username : 'Unknown'} (${socket.id}) left chat room: ${chatId}`);
    });

    // ************************************************************
    // *** CORRECTED: Socket.IO 'sendMessage' handler ***
    // ************************************************************
    socket.on('sendMessage', async ({ chatId, content }) => {
        try {
            // Basic validation
            if (!chatId || !content || !socket.user || !socket.user._id) {
                socket.emit('messageError', 'Chat ID, content, and authenticated user are required.');
                console.warn(`[SOCKET ERROR] Invalid message data or missing user: chatId=${chatId}, content=${content}, user=${socket.user ? socket.user._id : 'none'}`);
                return;
            }

            // Ensure chat exists and user is a participant
            const chat = await Chat.findById(chatId);
            if (!chat || !chat.participants.includes(socket.user._id)) {
                socket.emit('messageError', 'Not authorized to send message in this chat.');
                console.warn(`[SOCKET ERROR] User ${socket.user.username} tried to send message to unauthorized/non-existent chat ${chatId}.`);
                return;
            }

            // Create and save the new message document
            const newMessage = new Message({
                chat: chatId,
                sender: socket.user._id, // Assign the ObjectId of the sender
                content: content,
                readBy: [socket.user._id] // Mark as read by the sender upon creation
            });

            const savedMessage = await newMessage.save();
            console.log(`[SOCKET] New message saved with ID: ${savedMessage._id}`);

            // Update the chat's lastMessage and updatedAt fields
            // The schema expects an ObjectId for lastMessage, so assign savedMessage._id
            chat.lastMessage = savedMessage._id; // <--- THIS IS THE KEY FIX
            chat.updatedAt = savedMessage.createdAt; // Use message's creation time for chat update
            await chat.save(); // Save the updated chat document
            console.log(`[SOCKET] Chat ${chatId} updated with lastMessage ID: ${savedMessage._id}`);

            // Populate sender details for the message before emitting to clients
            const messageToEmit = await Message.findById(savedMessage._id)
                .populate('sender', 'username profilePicture')
                .lean(); // Convert to plain JS object for efficient emission

            if (!messageToEmit) {
                console.error(`[SOCKET ERROR] Failed to find or populate message ${savedMessage._id} after saving.`);
                socket.emit('messageError', 'Failed to process message after saving.');
                return;
            }

            // Emit the fully populated message to all participants in the chat room
            io.to(chatId).emit('receive_message', messageToEmit);
            console.log(`[SOCKET] Emitted 'receive_message' to chat room ${chatId}. Message content: ${messageToEmit.content}`);

            // Fetch and emit updated chat details for sidebar/chat list updates
            const updatedChatForSidebar = await Chat.findById(chatId)
                .populate('participants', 'username profilePicture')
                .populate({
                    path: 'lastMessage', // Populate the lastMessage field
                    populate: {          // Then populate its nested 'sender' field
                        path: 'sender',
                        select: 'username profilePicture'
                    }
                })
                .lean(); // Use .lean() here too

            if (updatedChatForSidebar) {
                // Ensure correct formatting for _id before sending
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

                // Emit to all participants' personal rooms
                updatedChatForSidebar.participants.forEach(participant => {
                    const participantRoom = `user_${participant._id}`;
                    if (io.sockets.adapter.rooms.has(participantRoom)) {
                        io.to(participantRoom).emit('chatUpdated', updatedChatForSidebar);
                        console.log(`[SOCKET] Emitted 'chatUpdated' for chat ${chatId} to user room: ${participantRoom}`);
                    }
                });
            }


        } catch (error) {
            console.error('Error sending message via socket:', error);
            socket.emit('messageError', { message: 'Server error during message send.', error: error.message });
        }
    });

    // ************************************************************
    // *** Socket.IO 'mark_as_read' handler (Minor adjustments) ***
    // ************************************************************
    socket.on('mark_as_read', async ({ chatId }) => {
        try {
            if (!chatId || !socket.user || !socket.user._id) {
                console.warn(`[SOCKET] Invalid mark_as_read request: chatId=${chatId}, user=${socket.user ? socket.user._id : 'none'}`);
                return;
            }

            const chat = await Chat.findById(chatId);
            if (!chat || !chat.participants.includes(socket.user._id)) {
                console.warn(`[SOCKET] User ${socket.user.username} tried to mark non-existent/unauthorized chat ${chatId} as read.`);
                return;
            }

            // Mark messages as read for this user in this chat, only messages NOT sent by this user
            const updateResult = await Message.updateMany(
                {
                    chat: chatId,
                    sender: { $ne: socket.user._id }, // Only mark messages sent by others
                    readBy: { $ne: socket.user._id }   // Only messages not already read by this user
                },
                { $addToSet: { readBy: socket.user._id } }
            );
            console.log(`[SOCKET] Messages in chat ${chatId} marked as read by ${socket.user.username}. Modified count: ${updateResult.modifiedCount}`);

            // Fetch the updated chat for sidebar if needed, to reflect changes in unread count on frontend
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
                // Ensure correct formatting for _id before sending
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

                // Emit 'chatUpdated' to all participants' personal rooms
                chat.participants.forEach(participantId => {
                    const participantRoom = `user_${participantId.toString()}`;
                    if (io.sockets.adapter.rooms.has(participantRoom)) {
                        io.to(participantRoom).emit('chatUpdated', updatedChatForSidebar);
                        console.log(`[SOCKET] Emitted 'chatUpdated' for read status to user room: ${participantRoom}`);
                    }
                });
            }

        } catch (error) {
            console.error('Error marking messages as read via socket:', error);
            socket.emit('messageError', 'Server error marking messages as read.');
        }
    });

    socket.on('disconnect', () => {
        console.log(`Socket.IO: User disconnected - ${socket.user ? socket.user.username : 'Unknown'} (${socket.id})`);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));