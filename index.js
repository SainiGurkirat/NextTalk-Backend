const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messagesRouter = require('./routes/messages');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ['GET', 'POST']
    }
});

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messagesRouter);


// connect to mongodb
console.log("Connecting to MongoDB...");
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("Mongoose connected successfully");
  })
  .catch((err) => {
    console.error("Connection failed:", err.message);
    process.exit(1);
  });

// socket connection
io.on('connection', (socket) => {
    console.log("User connected:", socket.id);

    socket.on('send-message', async (msg) => {
        // Broadcast to room
        io.to(msg.chatId).emit('receive-message', msg);
      
        // Save to DB
        const Message = require('./models/message');  // make sure correct path
        const messageDoc = new Message(msg);
        await messageDoc.save();
      });

    socket.on('send-mnessage', (data) => {
        io.to(data.chatId).emit('receive-message', data);
    });

    socket.on('join-room', (chatId) => {
        socket.join(chatId);
        console.log(`User with ID: ${socket.id} joined room: ${chatId}`);

    })

    // webrtc signaling
    socket.on('call-user', (data) => {
        io.to(data.to).emit('call-made', {
            offer: data.offer,
            socket: data.socket
        });
    });

    socket.on('answer-call', (data) => {  
        io.to(data.to).emit('call-accepted', {
            socket: data.socket,
            answer: data.answer                 
        });
});
});



server.listen(process.env.PORT || 5000, () => {
    console.log(`Server is running on port ${process.env.PORT || 5000}`);
});
