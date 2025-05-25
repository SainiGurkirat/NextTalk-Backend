const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Ensure your User model is correctly defined here
const authenticateToken = require('../middleware/auth'); // Your JWT authentication middleware

// Route to get the current authenticated user's profile
// Accessible at: GET /api/users/me
router.get('/me', authenticateToken, async (req, res) => {
    try {
        // req.user.id comes from the authenticateToken middleware after verifying the JWT
        const user = await User.findById(req.user.id).select('-password'); // Exclude password from response
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Route to search for other users by username or email
// Accessible at: GET /api/users/search?query=...
router.get('/search', authenticateToken, async (req, res) => {
    try {
        const { query } = req.query; // Get search query from URL like ?query=GDay

        if (!query) {
            return res.status(200).json([]); // Return an empty array if no query is provided
        }

        // Perform a case-insensitive search on username or email
        // $regex for pattern matching, $options: 'i' for case-insensitivity
        const users = await User.find({
            $or: [
                { username: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } }
            ],
            _id: { $ne: req.user.id } // Exclude the current user from search results
        }).select('username email _id'); // Only return necessary fields

        res.json(users); // Send the found users as a JSON array
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
