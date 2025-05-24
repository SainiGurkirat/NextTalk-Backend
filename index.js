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



app.use(cors({
    origin: process.env.CLIENT_URL, // Allows requests only from your frontend's origin
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'] // Allowed request headers
}));

const io = socketIo(server, {
    cors: {
        origin: process.env.CLIENT_URL, // Replace with your frontend URL in production
        methods: ["GET", "POST"]
    }
});

// Middleware to parse JSON request bodies
app.use(express.json());

// Connect to MongoDB
connectDB();

// --- API Routes ---
// Use the imported route modules for different API endpoints
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);

// --- Socket.IO Real-time Communication ---
// Pass the io instance to the socket handler
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    chatSocketHandler(io, socket); // Handle chat-related socket events
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // In a real app, you'd update user's online status in DB here
    });
});

// --- Server Startup ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`For frontend development, ensure your CLIENT_URL in .env is set to your Next.js app's URL (e.g., http://localhost:3000)`);
});