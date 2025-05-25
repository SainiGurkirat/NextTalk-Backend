const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Ensure your User model is correctly defined here
const authenticateToken = require('../middleware/auth'); // Your JWT authentication middleware

// Route to get the current authenticated user's profile
// Accessible at: GET /api/users/me
router.get('/me', authenticateToken, async (req, res) => {
    try {
        // DEBUG: Log the req.user object to see its structure
        console.log('DEBUG (GET /api/users/me): req.user object from JWT:', req.user);

        // CORRECTED: Use req.user.userId to match the actual JWT payload structure
        const currentUserId = req.user.userId; 
        console.log('DEBUG (GET /api/users/me): Attempting to fetch user with ID:', currentUserId);

        const user = await User.findById(currentUserId).select('-password'); // Exclude password from response
        
        if (!user) {
            console.log('DEBUG (GET /api/users/me): User not found in DB for ID:', currentUserId);
            return res.status(404).json({ message: 'User not found' });
        }
        console.log('DEBUG (GET /api/users/me): User found:', user.username);
        res.json(user);
    } catch (error) {
        console.error('ERROR (GET /api/users/me): Error fetching user profile:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Route to search for other users by username or email
// Accessible at: GET /api/users/search?query=...
router.get('/search', authenticateToken, async (req, res) => {
    try {
        // CORRECTED: Use req.user.userId here as well for consistency
        const currentUserId = req.user.userId; 
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
            _id: { $ne: currentUserId } // Exclude the current user from search results
        }).select('username email _id'); // Only return necessary fields

        res.json(users); // Send the found users as a JSON array
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
