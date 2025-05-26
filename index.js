// backend/index.js
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
const messageRoutes = require('./routes/messages');

// Import Models
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');

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
// *** CRITICAL CHANGE: Move Socket.IO Setup and io.use middleware here ***
// ************************************************************

// Socket.IO Setup - MUST BE BEFORE routes that use req.io
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Middleware to attach io to req - MUST BE BEFORE routes that use req.io
app.use((req, res, next) => {
    req.io = io; // Attach the 'io' instance to the request object
    next();
});

// ************************************************************
// *** End of CRITICAL CHANGE ***
// ************************************************************


// Define API Routes (now they will have access to req.io)
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes); // This route now correctly receives req.io
app.use('/api/messages', messageRoutes);

// Basic root route for testing server status
app.get('/', (req, res) => {
    res.send('API is running...');
});

// Socket.IO Authentication Middleware (optional, but good for securing sockets)
// This applies to the socket.io connection itself, not to Express routes
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
        socket.join(`user_${socket.user._id.toString()}`);
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

    socket.on('disconnect', () => {
        console.log(`Socket.IO: User disconnected - ${socket.user ? socket.user.username : 'Unknown'} (${socket.id})`);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));