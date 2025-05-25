const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true }, // Hashed password
    profilePicture: { type: String, default: null },
    contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    onlineStatus: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
