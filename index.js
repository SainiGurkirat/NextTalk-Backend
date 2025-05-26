// backend/index.js
const express = require('express');
const dotenv = require('dotenv');
const mongoose = require('mongoose'); // Make sure mongoose is imported for DB connection
const http = require('http'); // Required for Socket.IO
const { Server } = require('socket.io'); // Socket.IO Server
const jwt = require('jsonwebtoken'); // For Socket.IO auth

// Import routes (assuming they are directly in the routes folder and contain logic)
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chats');
const messageRoutes = require('./routes/messages'); // Corrected import path

// Import Models (needed for Socket.IO logic directly in index.js)
const User = require('./models/User');
const Chat = require('./models/Chat');
const Message = require('./models/Message');


dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI) // Assuming MONGODB_URI in .env
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

const app = express();
const server = http.createServer(app); // Create HTTP server from express app

// Middleware to parse JSON bodies
app.use(express.json());

// CORS setup (important for frontend communication)
// This should be before your routes
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || 'http://localhost:3000'); // Allow your frontend origin
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', true); // Important for cookies/credentials if you use them
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200); // Handle pre-flight requests
    }
    next();
});

// Define API Routes
// The '/api' prefix is added here, so authRoutes will handle '/api/auth/*'
app.use('/api/auth', authRoutes); // THIS IS CRUCIAL FOR /api/auth/login
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/messages', messageRoutes);

// Basic root route for testing server status
app.get('/', (req, res) => {
    res.send('API is running...');
});

// Socket.IO Setup
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'], // Allow GET/POST for handshake
        credentials: true
    }
});

// Socket.IO Authentication Middleware (optional, but good for securing sockets)
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

    // Register user with their socket ID (for targeted messages)
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
        // No need to explicitly leave rooms here, socket.io handles it on disconnect
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));