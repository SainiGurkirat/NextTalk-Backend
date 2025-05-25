// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http'); // Import http module
const { Server } = require('socket.io'); // Import Socket.IO Server

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chats');

// Load environment variables from .env file
dotenv.config();

const app = express();

// --- Standard Express Middleware ---
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Allow your frontend to connect
    credentials: true // Important for cookies, if you were using them for auth
}));
app.use(express.json()); // Parses JSON bodies of incoming requests

// --- HTTP Server and Socket.IO Initialization ---
// Create an HTTP server from the Express app.
// Socket.IO needs to be attached to an HTTP server directly.
const server = http.createServer(app);

// Initialize Socket.IO server
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Allow your frontend to connect
        methods: ["GET", "POST"] // Specify allowed HTTP methods for CORS
    }
});

// --- CRITICAL: Socket.IO Middleware to Attach 'io' to Request Object ---
// This middleware runs for every incoming HTTP request.
// It attaches the `io` (Socket.IO server) instance to the `req` object,
// making `req.io` available in all subsequent route handlers.
// This MUST be placed BEFORE any routes that need to use `req.io`.
app.use((req, res, next) => {
    req.io = io; // Attach the Socket.IO instance
    next();      // Pass control to the next middleware or route handler
});
// --- END CRITICAL SECTION ---


// --- Define API Routes ---
// These routes will now have `req.io` available thanks to the middleware above.
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes); // Your chat routes that emit socket events

// --- Database Connection ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err)); // Added more descriptive error

// --- Socket.IO Connection Logic ---
// This handles WebSocket connections and events
io.on('connection', (socket) => {
    console.log(`Socket.IO: User connected - Socket ID: ${socket.id}`);

    // Event listener for a client joining a specific chat room
    socket.on('join_chat', (chatId) => {
        socket.join(chatId);
        console.log(`Socket.IO: User ${socket.id} joined chat room: ${chatId}`);
    });

    // Event listener for a client disconnecting
    socket.on('disconnect', () => {
        console.log(`Socket.IO: User disconnected - Socket ID: ${socket.id}`);
    });

    // You can add other socket event listeners here if needed,
    // but message sending is primarily handled by the REST API then emitted.
});


// --- Server Start ---
const PORT = process.env.PORT || 5000;

// Start the HTTP server (which Socket.IO is attached to)
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});