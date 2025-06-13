const express = require('express');
const router = express.Router();
const User = require('../models/User');
const protect = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../uploads/profile_pictures');
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, `${req.user._id}-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
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


router.get('/search', protect, async (req, res) => {
    const searchQuery = req.query.q;

    if (!searchQuery || searchQuery.trim() === '') {
        return res.status(400).json({ message: 'Search query is required' });
    }

    try {
        function escapeRegex(string) {
            return string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        }

        const regex = new RegExp('^' + escapeRegex(searchQuery), 'i');

        const users = await User.find({ username: { $regex: regex } }).select('-password');

        res.json(users);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

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



router.put('/profile-picture', protect, upload.single('profilePicture'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.profilePicture && user.profilePicture !== '/uploads/profile_pictures/default.png') {
            const oldImagePath = path.join(__dirname, '..', user.profilePicture.replace(/^\/+/, ''));
            fs.unlink(oldImagePath, (err) => {
                if (err) {
                } else {
                }
            });
        }

        // Store relative path (e.g., /uploads/profile_pictures/filename.png) for frontend to fetch from backend
        const relativePath = `/uploads/profile_pictures/${req.file.filename}`;
        user.profilePicture = req.protocol + '://' + req.get('host') + relativePath;
        await user.save();

        res.json({ message: 'Profile picture updated successfully!', profilePicture: user.profilePicture });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to update profile picture.' });
    }
});

router.get('/check-username', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ message: 'Username is required.' });
    }
    try {
        const userExists = await User.findOne({ username });
        res.json({ isAvailable: !userExists });
    } catch (error) {
        res.status(500).json({ message: 'Server error during username check.' });
    }
});

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
        res.status(500).json({ message: error.message || 'Failed to update username.' });
    }
});

router.get('/check-email', async (req, res) => {
    const { email } = req.query;
    if (!email) {
        return res.status(400).json({ message: 'Email is required.' });
    }
    try {
        const userExists = await User.findOne({ email });
        res.json({ isAvailable: !userExists });
    } catch (error) {
        res.status(500).json({ message: 'Server error during email check.' });
    }
});


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
        res.status(500).json({ message: error.message || 'Failed to update email.' });
    }
});

router.put('/password', protect, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current password and new password are required.' });
    }
    if (newPassword.length < 6) {
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
        res.status(500).json({ message: error.message || 'Failed to update password.' });
    }
});


module.exports = router;