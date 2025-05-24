const Message = require('../models/Message'); // Import Message model
const Chat = require('../models/Chat'); // Import Chat model

const chatSocketHandler = (io, socket) => {
    // When a user joins a specific chat room
    socket.on('joinChat', (chatId) => {
        socket.join(chatId);
        console.log(`User ${socket.id} joined chat room: ${chatId}`);
    });

    // When a user sends a message
    socket.on('sendMessage', async (data) => {
        const { chatId, senderId, content, type = 'text', fileUrl = null } = data;
        console.log(`Message received for chat ${chatId} from ${senderId}: ${content}`);

        try {
            // Save message to database
            const newMessage = new Message({
                chat: chatId,
                sender: senderId,
                content,
                type,
                fileUrl
            });
            await newMessage.save();

            // Update last message in chat
            await Chat.findByIdAndUpdate(chatId, {
                lastMessage: {
                    sender: senderId,
                    content: content,
                    timestamp: newMessage.timestamp
                }
            });

            // Populate sender details for the emitted message
            const populatedMessage = await Message.findById(newMessage._id).populate('sender', 'username profilePicture');

            // Emit message to all clients in the chat room
            io.to(chatId).emit('receiveMessage', populatedMessage);
            console.log(`Message emitted to chat ${chatId}`);

        } catch (error) {
            console.error('Error saving or emitting message:', error);
            socket.emit('messageError', { chatId, error: 'Failed to send message' });
        }
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
        const { chatId, username } = data;
        socket.to(chatId).emit('userTyping', { chatId, username });
    });

    // Handle message read receipt
    socket.on('readMessage', async (data) => {
        const { messageId, userId } = data;
        try {
            const message = await Message.findById(messageId);
            if (message && !message.readBy.includes(userId)) {
                message.readBy.push(userId);
                await message.save();
            }
        } catch (error) {
            console.error('Error marking message as read:', error);
        }
    });
};

module.exports = chatSocketHandler;