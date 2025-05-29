// backend/routes/users.js
const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Assuming your User model
const protect = require('../middleware/auth'); // Your authentication middleware
const bcrypt = require('bcryptjs'); // For password hashing and comparison
const multer = require('multer'); // For handling file uploads
const path = require('path'); // Node.js path module for file paths
const fs = require('fs'); // Node.js file system module

// --- Multer Configuration for Profile Picture Upload ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Adjusted path to store uploads within the backend's 'uploads' folder
        // Assuming current file is in 'backend/routes', '../uploads/profile_pictures' leads to 'backend/uploads/profile_pictures'
        const uploadPath = path.join(__dirname, '../uploads/profile_pictures');
        // Ensure the directory exists
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, `${req.user._id}-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only images (jpeg, jpg, png, gif) are allowed!'));
    }
});


// @desc    Search for users
// @route   GET /api/users/search
// @access  Private
router.get('/search', protect, async (req, res) => {
    const searchQuery = req.query.q; // Get the 'q' query parameter
    console.log(`[BACKEND SEARCH] Search query received: '${searchQuery}'`);

    if (!searchQuery || searchQuery.trim() === '') {
        console.log("[BACKEND SEARCH] Validation failed: Search query is required.");
        return res.status(400).json({ message: 'Search query is required' });
    }

    try {
        function escapeRegex(string) {
            return string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'); // Escape special characters for regex
        }

        const regex = new RegExp('^' + escapeRegex(searchQuery), 'i');

        const users = await User.find({ username: { $regex: regex } }).select('-password');

        console.log(`[BACKEND SEARCH] Found ${users.length} users for query: '${searchQuery}'`);
        res.json(users);
    } catch (err) {
        console.error('[BACKEND SEARCH ERROR]:', err.message);
        res.status(500).send('Server Error');
    }
});

// @desc    Get current authenticated user's profile
// @route   GET /api/users/me
// @access  Private
router.get('/me', protect, async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Not authorized, user data not found' });
    }

    res.status(200).json({
        _id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        profilePicture: req.user.profilePicture || null,
    });
});


// --- NEW ROUTES FOR SETTINGS PAGE ---

// @desc    Update user profile picture
// @route   PUT /api/users/profile-picture
// @access  Private
router.put('/profile-picture', protect, upload.single('profilePicture'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Delete old profile picture if it exists and is not a default/placeholder
        if (user.profilePicture && user.profilePicture !== '/uploads/profile_pictures/default.png') {
            const oldImagePath = path.join(__dirname, '..', user.profilePicture.replace(/^\/+/, ''));
                    fs.unlink(oldImagePath, (err) => {
                        if (err) {
                            console.error(`Error deleting old profile picture at ${oldImagePath}:`, err.message);
                        } else {
                            console.log(`Deleted old profile picture at ${oldImagePath}`);
                        }
                    });
            }
        

        // Store relative path (e.g., /uploads/profile_pictures/filename.png) for frontend to fetch from backend
        const relativePath = `/uploads/profile_pictures/${req.file.filename}`;
        user.profilePicture = req.protocol + '://' + req.get('host') + relativePath;
        await user.save();

        res.json({ message: 'Profile picture updated successfully!', profilePicture: user.profilePicture });
    } catch (error) {
        console.error('[BACKEND PFP UPDATE ERROR]:', error.message);
        res.status(500).json({ message: error.message || 'Failed to update profile picture.' });
    }
});

// @desc    Check username availability
// @route   GET /api/users/check-username
// @access  Public (or Private, depends on your preference, but usually public for registration)
router.get('/check-username', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ message: 'Username is required.' });
    }
    try {
        const userExists = await User.findOne({ username });
        res.json({ isAvailable: !userExists });
    } catch (error) {
        console.error('[BACKEND USERNAME CHECK ERROR]:', error.message);
        res.status(500).json({ message: 'Server error during username check.' });
    }
});

// @desc    Update username
// @route   PUT /api/users/username
// @access  Private
router.put('/username', protect, async (req, res) => {
    const { username } = req.body;
    if (!username || username.trim() === '') {
        return res.status(400).json({ message: 'Username cannot be empty.' });
    }
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ message: 'Username must be between 3 and 20 characters.' });
    }

    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Check if new username is the same as current
        if (user.username === username) {
            return res.status(200).json({ message: 'Username is already set to this value.' });
        }

        // Check for uniqueness for other users
        const existingUser = await User.findOne({ username: username });
        if (existingUser && existingUser._id.toString() !== user._id.toString()) {
            return res.status(409).json({ message: 'Username is already taken.' });
        }

        user.username = username;
        await user.save();

        res.json({ message: 'Username updated successfully!', username: user.username });
    } catch (error) {
        console.error('[BACKEND USERNAME UPDATE ERROR]:', error.message);
        res.status(500).json({ message: error.message || 'Failed to update username.' });
    }
});

// @desc    Check email availability
// @route   GET /api/users/check-email
// @access  Public (or Private)
router.get('/check-email', async (req, res) => {
    const { email } = req.query;
    if (!email) {
        return res.status(400).json({ message: 'Email is required.' });
    }
    try {
        const userExists = await User.findOne({ email });
        res.json({ isAvailable: !userExists });
    } catch (error) {
        console.error('[BACKEND EMAIL CHECK ERROR]:', error.message);
        res.status(500).json({ message: 'Server error during email check.' });
    }
});


// @desc    Update user email
// @route   PUT /api/users/email
// @access  Private
router.put('/email', protect, async (req, res) => {
    const { email } = req.body;
    if (!email || email.trim() === '') {
        return res.status(400).json({ message: 'Email cannot be empty.' });
    }
    // Basic email format validation (more robust validation might be needed)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Invalid email format.' });
    }

    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Check if new email is the same as current
        if (user.email === email) {
            return res.status(200).json({ message: 'Email is already set to this value.' });
        }

        // Check for uniqueness for other users
        const existingUser = await User.findOne({ email: email });
        if (existingUser && existingUser._id.toString() !== user._id.toString()) {
            return res.status(409).json({ message: 'Email is already registered.' });
        }

        user.email = email;
        await user.save();

        res.json({ message: 'Email updated successfully!', email: user.email });
    } catch (error) {
        console.error('[BACKEND EMAIL UPDATE ERROR]:', error.message);
        res.status(500).json({ message: error.message || 'Failed to update email.' });
    }
});

// @desc    Update user password
// @route   PUT /api/users/password
// @access  Private
router.put('/password', protect, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current password and new password are required.' });
    }
    if (newPassword.length < 6) { // Enforce minimum password length
        return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
    }

    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid current password.' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.json({ message: 'Password updated successfully!' });
    } catch (error) {
        console.error('[BACKEND PASSWORD UPDATE ERROR]:', error.message);
        res.status(500).json({ message: error.message || 'Failed to update password.' });
    }
});


module.exports = router;