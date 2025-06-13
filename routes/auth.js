const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// handle user registration
router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (password.length < 6) {
        return res.status(400).json({ message: 'password must be at least 6 characters long.' });
    }

    try {
        let userEmail = await User.findOne({ email });
        let userUsername = await User.findOne({ username });
        if (userUsername) {
            return res.status(400).json({ message: 'username already exists' });
        }
        if (userEmail) {
            return res.status(400).json({ message: 'email already exists' });
        }

        // hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // create a new user instance
        user = new User({
            username,
            email,
            password: hashedPassword
        });

        // save the user to the database
        await user.save();

        // create jwt payload
        const payload = {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                profilePicture: user.profilePicture
            }
        };

        // sign the jwt token
        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '1h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, message: 'registration successful!' });
            }
        );

    } catch (err) {
        console.error('[backend register error]:', err.message);
        res.status(500).json({ message: 'server error during registration.', error: err.message });
    }
});

// handle user login and token generation
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // basic validation for missing fields
    if (!email || !password) {
        return res.status(400).json({ message: 'email and password are required.' });
    }

    try {
        // find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'invalid credentials' });
        }

        // compare provided password with hashed password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'invalid credentials' });
        }

        // generate jwt token
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // send token and user info in response
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
        console.error('[backend login error]:', err.message);
        res.status(500).json({ message: 'server error during login.', error: err.message });
    }
});

// get authenticated user profile
router.get('/me', authMiddleware, async (req, res) => {
    try {
        // find user by id from the authenticated request
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'user not found' });
        }
        res.json(user);
    } catch (err) {
        console.error('[backend auth/me error]:', err.message);
        res.status(500).json({ message: 'server error getting user profile.', error: err.message });
    }
});

module.exports = router;