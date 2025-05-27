// backend/routes/users.js
const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Assuming your User model
const protect = require('../middleware/auth'); // Your authentication middleware

// @desc    Search for users
// @route   GET /api/users/search
// @access  Private
router.get('/search', protect, async (req, res) => {
    const searchQuery = req.query.q; // Get the 'q' query parameter
    console.log(`[BACKEND SEARCH] Search query received: '${searchQuery}'`); // Add this log

    // *** THIS IS THE CRITICAL VALIDATION PART ***
    if (!searchQuery || searchQuery.trim() === '') {
        console.log("[BACKEND SEARCH] Validation failed: Search query is required."); // Add this log
        return res.status(400).json({ message: 'Search query is required' });
    }

    try {
        // Perform the search (example: partial match on username)
        const users = await User.find({
            username: { $regex: searchQuery, $options: 'i' } // Case-insensitive partial match
        }).select('-password'); // Exclude password from results

        console.log(`[BACKEND SEARCH] Found <span class="math-inline">\{users\.length\} users for query\: '</span>{searchQuery}'`); // Add this log
        res.json(users);
    } catch (err) {
        console.error('[BACKEND SEARCH ERROR]:', err.message); // Add this log
        res.status(500).send('Server Error');
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