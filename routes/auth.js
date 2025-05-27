// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// @route   POST /api/auth/register
// @desc    Register user
// @access  Public
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({
            username,
            email,
            password: hashedPassword
        });

        await user.save();

        const payload = {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                profilePicture: user.profilePicture
            }
        };

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '1h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, message: 'Registration successful!' });
            }
        );

    } catch (err) {
        console.error('[BACKEND REGISTER ERROR]:', err.message);
        res.status(500).json({ message: 'Server Error during registration.', error: err.message });
    }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
    // --- THIS IS THE CRITICAL LOG. ENSURE IT'S HERE AND SAVED. ---
    console.log('[BACKEND LOGIN] Request headers:', req.headers); // Add headers to see content-type
    console.log('[BACKEND LOGIN] Raw req.body received:', req.body);
    // --- END CRITICAL LOGS ---

    const { email, password } = req.body;

    // Basic validation for missing fields
    if (!email || !password) {
        // This log will only happen if email or password are truly undefined/null after destructuring
        console.log(`[BACKEND LOGIN] Missing email or password. Email: ${email}, Password: ${password}`);
        return res.status(400).json({ message: 'Email and password are required.' });
    }

    console.log(`[BACKEND LOGIN] Attempting login for email: ${email}`);

    try {
        const user = await User.findOne({ email });
        if (!user) {
            console.log(`[BACKEND LOGIN] User not found for email: ${email}`);
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        console.log("Plain text password from frontend (login):", password);
        console.log("Hashed password retrieved from DB (login):", user.password);

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log(`[BACKEND LOGIN] Password mismatch for user: ${email}`);
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        console.log(`[BACKEND LOGIN] User ${user.username} logged in. Token generated: ${token ? 'YES' : 'NO'}`);
        console.log(`[BACKEND LOGIN] Sending response with token for user: ${user.username}`);

        res.json({
            token,
            user: {
                _id: user._id,
                username: user.username,
                email: user.email,
                profilePicture: user.profilePicture
            }
        });
    } catch (err) {
        console.error('[BACKEND LOGIN ERROR]:', err.message);
        res.status(500).json({ message: 'Server Error during login.', error: err.message });
    }
});

// @route   GET /api/auth/me
// @desc    Get authenticated user profile
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (err) {
        console.error('[BACKEND AUTH/ME ERROR]:', err.message);
        res.status(500).json({ message: 'Server Error getting user profile.', error: err.message });
    }
});

module.exports = router;