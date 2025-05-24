const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Message = require('../models/Message');

function getChatId(userId1, userId2) {
  return [userId1, userId2].sort().join('_');
}

// Search users (exclude yourself)
router.get('/users', async (req, res) => {
  const { search, userId } = req.query;
  if (!search) return res.json([]);
  const users = await User.find({
    username: { $regex: search, $options: 'i' },
    _id: { $ne: userId },
  }).select('_id username');
  res.json(users);
});

// Get messages for chatId
router.get('/messages/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const messages = await Message.find({ chatId }).sort({ createdAt: 1 });
  res.json(messages);
});

// Send message
router.post('/messages', async (req, res) => {
  const { senderId, receiverId, text } = req.body;
  if (!senderId || !receiverId || !text) {
    return res.status(400).json({ message: 'Missing fields' });
  }

  const chatId = getChatId(senderId, receiverId);

  const message = new Message({ chatId, sender: senderId, receiver: receiverId, text });
  await message.save();

  res.json(message);
});

module.exports = router;
