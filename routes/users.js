// backend/routes/users.js
const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Assuming your User model
const protect = require('../middleware/auth'); // Your authentication middleware

// @desc    Search for users
// @route   GET /api/users/search
// @access  Private
router.get('/search', protect, async (req, res) => {
    const { query } = req.query;
    if (!query) {
        return res.status(400).json({ message: 'Search query is required' });
    }
    try {
        // Case-insensitive search for username or email
        const users = await User.find({
            $or: [
                { username: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } }
            ]
        }).select('-password'); // Exclude passwords
        res.status(200).json(users);
    } catch (error) {
        console.error('User search error:', error);
        res.status(500).json({ message: 'Server error during user search' });
    }
});

// @desc    Get current authenticated user's profile
// @route   GET /api/users/me
// @access  Private
router.get('/me', protect, async (req, res) => {
    // The 'protect' middleware has already fetched the user from the DB
    // and attached it to req.user. We just need to respond with it.
    if (!req.user) {
        // This case should ideally not happen if 'protect' works, but good for safety
        return res.status(401).json({ message: 'Not authorized, user data not found' });
    }

    // You can also select specific fields if you don't want to send everything
    // But sending req.user directly is fine if you're sure about its content.
    res.status(200).json({
        _id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        profilePicture: req.user.profilePicture || null,
        // Add any other fields from req.user that you need on the frontend
    });
});


module.exports = router;