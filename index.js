const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const cors = require('cors')

// Load environment variables from .env file
dotenv.config();

// Import database connection function
const connectDB = require('./config/db');

// Import API routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chats');

// Import Socket.IO handlers
const chatSocketHandler = require('./socketHandlers/chatHandler');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Middleware to parse JSON request bodies - KEEP ONLY ONE
app.use(express.json()); // <--- Keep this one

app.use(cors({
    origin: process.env.CLIENT_URL, // Allows requests only from your frontend's origin
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'] // Allowed request headers
}));

const io = socketIo(server, {
    cors: {
        origin: process.env.CLIENT_URL,
        methods: ["GET", "POST"]
    }
});


app.use(express.json()); 


// Connect to MongoDB
connectDB();

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);


io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    chatSocketHandler(io, socket); 

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// --- Server Startup ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});