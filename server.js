/**
 * ============================================
 *  🍳 COOKING BATTLE - MULTIPLAYER SERVER 🍳
 *  Overcooked-style Isometric Cooking Game
 * ============================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const admin = require('firebase-admin');

const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json()); // Enable JSON body parsing for API
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/three', express.static(path.join(__dirname, 'node_modules/three')));

// ============ MAP EDITOR API ============
app.post('/api/save-map', (req, res) => {
    const { name, layout, width, height } = req.body;
    if (!name || !layout) return res.status(400).send('Missing data');

    const filePath = path.join(__dirname, 'maps', `${name}.json`);

    // Ensure maps directory exists (I already created it manually but safer here too)
    if (!fs.existsSync(path.join(__dirname, 'maps'))) {
        fs.mkdirSync(path.join(__dirname, 'maps'));
    }

    fs.writeFile(filePath, JSON.stringify({ layout, width, height }, null, 2), (err) => {
        if (err) {
            console.error('Error saving map:', err);
            return res.status(500).send('Error saving map');
        }
        console.log(`🗺️  Map saved: ${name}`);
        res.send({ success: true });
    });
});

app.get('/api/load-map/:name', (req, res) => {
    const name = req.params.name;
    const filePath = path.join(__dirname, 'maps', `${name}.json`);

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            // It's okay if map doesn't exist, just 404
            return res.status(404).send('Map not found');
        }
        res.send(JSON.parse(data));
    });
});

app.get('/api/list-maps', (req, res) => {
    const mapsDir = path.join(__dirname, 'maps');
    if (!fs.existsSync(mapsDir)) return res.json([]);

    fs.readdir(mapsDir, (err, files) => {
        if (err) return res.status(500).send('Error listing maps');
        const jsonFiles = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
        res.json(jsonFiles);
    });
});

app.delete('/api/delete-map/:name', (req, res) => {
    const name = req.params.name;
    const filePath = path.join(__dirname, 'maps', `${name}.json`);

    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) return res.status(500).send('Error deleting map');
            res.json({ success: true });
        });
    } else {
        res.status(404).send('Map not found');
    }
});

// ============ LEADERBOARD API ============
app.get('/api/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const category = req.query.category || 'score'; // score, wins, dishes

        // Filter only registered users (not guests)
        const registeredUsers = Object.entries(users)
            .filter(([id, user]) => user.type === 'account')
            .map(([id, user]) => ({
                id: id,
                uid: user.uid || id,
                username: user.username || user.name,
                profileImage: user.profileImage || 'chef_1',
                level: user.level || 1,
                stats: user.stats || {}
            }));

        // Sort based on category
        let sortedUsers;
        switch (category) {
            case 'wins':
                sortedUsers = registeredUsers.sort((a, b) =>
                    (b.stats.wins || 0) - (a.stats.wins || 0)
                );
                break;
            case 'dishes':
                sortedUsers = registeredUsers.sort((a, b) =>
                    (b.stats.dishesServed || 0) - (a.stats.dishesServed || 0)
                );
                break;
            case 'score':
            default:
                sortedUsers = registeredUsers.sort((a, b) =>
                    (b.stats.scoreTotal || 0) - (a.stats.scoreTotal || 0)
                );
                break;
        }

        // Return top N users
        const leaderboard = sortedUsers.slice(0, limit).map((user, index) => ({
            rank: index + 1,
            uid: user.uid,
            username: user.username,
            profileImage: user.profileImage,
            level: user.level,
            totalScore: user.stats.scoreTotal || 0,
            wins: user.stats.wins || 0,
            dishesServed: user.stats.dishesServed || 0,
            gamesPlayed: user.stats.gamesPlayed || 0
        }));

        res.json(leaderboard);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// ============ FIREBASE SETUP ============
let db = null;
const FIREBASE_KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');

try {
    if (fs.existsSync(FIREBASE_KEY_PATH)) {
        const serviceAccount = require(FIREBASE_KEY_PATH);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log('🔥 Firebase Cloud Firestore Connected (via JSON)!');
    } else if (process.env.FIREBASE_CONFIG) {
        // Fallback for Railway/Cloud Run: Use ENV variable
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log('🔥 Firebase Cloud Firestore Connected (via ENV)!');
    } else {
        console.warn('⚠️ No Firebase credentials found. Database will not be persistent.');
    }
} catch (e) {
    console.error('❌ Firebase Init Error:', e.message || e);
}

// ============ SERVICE STATUS ============
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        database: db ? 'connected' : 'disconnected',
        userCount: Object.keys(users).length,
        accountCount: Object.values(users).filter(u => u.type === 'account').length,
        guestCount: Object.values(users).filter(u => u.type === 'guest').length,
        version: '1.0.1'
    });
});

// ============ FIREBASE TEST ENDPOINT ============
app.get('/test-firebase', async (req, res) => {
    if (!db) {
        return res.json({
            status: 'error',
            message: 'Firebase not initialized',
            connected: false
        });
    }

    try {
        // Try to read from users collection
        const snapshot = await db.collection('users').limit(1).get();
        
        res.json({
            status: 'success',
            message: 'Firebase connection working',
            connected: true,
            canRead: true,
            userCount: snapshot.size
        });
    } catch (error) {
        res.json({
            status: 'error',
            message: error.message,
            connected: false,
            errorCode: error.code,
            errorDetails: error.details
        });
    }
});

// ============ DEBUG ENDPOINT - List all users ============
app.get('/debug/users', (req, res) => {
    const userList = Object.entries(users).map(([id, user]) => ({
        id: id,
        username: user.username || user.name,
        type: user.type,
        level: user.level,
        xp: user.xp,
        online: userToSocket[id] ? true : false
    }));

    res.json({
        totalUsers: userList.length,
        accounts: userList.filter(u => u.type === 'account').length,
        guests: userList.filter(u => u.type === 'guest').length,
        online: userList.filter(u => u.online).length,
        users: userList
    });
});

// ============ ACHIEVEMENT SYSTEM ============
function checkAchievements(user, player, room) {
    const stats = user.stats;
    let newAchievements = [];

    // First Dish Served - check if this was the first ever dish
    if (stats.dishesServed === 0 && player.dishesServed > 0) {
        newAchievements.push({ id: 'first_dish', name: 'First Dish!', description: 'Serve your first dish', unlockedAt: Date.now() });
    }

    // Kitchen Novice - Win your first game
    if (stats.wins >= 1 && !stats.achievements.some(a => a.id === 'kitchen_novice')) {
        newAchievements.push({ id: 'kitchen_novice', name: 'Kitchen Novice', description: 'Win your first game', unlockedAt: Date.now() });
    }

    // Co-op Achievements (5 levels)
    if (stats.coopGames >= 1 && !stats.achievements.some(a => a.id === 'coop_first')) {
        newAchievements.push({ id: 'coop_first', name: 'Teamwork!', description: 'Play your first co-op game', unlockedAt: Date.now() });
    }
    if (stats.coopGames >= 5 && !stats.achievements.some(a => a.id === 'coop_5')) {
        newAchievements.push({ id: 'coop_5', name: 'Good Partner', description: 'Play 5 co-op games', unlockedAt: Date.now() });
    }
    if (stats.coopGames >= 10 && !stats.achievements.some(a => a.id === 'coop_10')) {
        newAchievements.push({ id: 'coop_10', name: 'Team Player', description: 'Play 10 co-op games', unlockedAt: Date.now() });
    }
    if (stats.coopGames >= 25 && !stats.achievements.some(a => a.id === 'coop_25')) {
        newAchievements.push({ id: 'coop_25', name: 'Best Friends', description: 'Play 25 co-op games', unlockedAt: Date.now() });
    }
    if (stats.coopGames >= 50 && !stats.achievements.some(a => a.id === 'coop_50')) {
        newAchievements.push({ id: 'coop_50', name: 'Dynamic Duo', description: 'Play 50 co-op games', unlockedAt: Date.now() });
    }

    // Score Achievements (5 levels)
    if (player.score >= 100 && !stats.achievements.some(a => a.id === 'score_100')) {
        newAchievements.push({ id: 'score_100', name: 'Century Chef', description: 'Score 100 points in a game', unlockedAt: Date.now() });
    }
    if (player.score >= 200 && !stats.achievements.some(a => a.id === 'score_200')) {
        newAchievements.push({ id: 'score_200', name: 'Double Century', description: 'Score 200 points in a game', unlockedAt: Date.now() });
    }
    if (player.score >= 300 && !stats.achievements.some(a => a.id === 'score_300')) {
        newAchievements.push({ id: 'score_300', name: 'Triple Century', description: 'Score 300 points in a game', unlockedAt: Date.now() });
    }
    if (player.score >= 400 && !stats.achievements.some(a => a.id === 'score_400')) {
        newAchievements.push({ id: 'score_400', name: 'Quad Century', description: 'Score 400 points in a game', unlockedAt: Date.now() });
    }
    if (player.score >= 500 && !stats.achievements.some(a => a.id === 'score_500')) {
        newAchievements.push({ id: 'score_500', name: 'Legendary Chef', description: 'Score 500 points in a game', unlockedAt: Date.now() });
    }

    // Dishes Served Achievements (5 levels)
    if (player.dishesServed >= 5 && !stats.achievements.some(a => a.id === 'dishes_5')) {
        newAchievements.push({ id: 'dishes_5', name: 'Busy Chef', description: 'Serve 5 dishes in a game', unlockedAt: Date.now() });
    }
    if (player.dishesServed >= 10 && !stats.achievements.some(a => a.id === 'dishes_10')) {
        newAchievements.push({ id: 'dishes_10', name: 'Master Chef', description: 'Serve 10 dishes in a game', unlockedAt: Date.now() });
    }
    if (player.dishesServed >= 15 && !stats.achievements.some(a => a.id === 'dishes_15')) {
        newAchievements.push({ id: 'dishes_15', name: 'Expert Chef', description: 'Serve 15 dishes in a game', unlockedAt: Date.now() });
    }
    if (player.dishesServed >= 20 && !stats.achievements.some(a => a.id === 'dishes_20')) {
        newAchievements.push({ id: 'dishes_20', name: 'Elite Chef', description: 'Serve 20 dishes in a game', unlockedAt: Date.now() });
    }
    if (player.dishesServed >= 25 && !stats.achievements.some(a => a.id === 'dishes_25')) {
        newAchievements.push({ id: 'dishes_25', name: 'Godlike Chef', description: 'Serve 25 dishes in a game', unlockedAt: Date.now() });
    }

    // Perfect Dishes (5 levels)
    if (player.perfectDishes >= 3 && !stats.achievements.some(a => a.id === 'perfect_3')) {
        newAchievements.push({ id: 'perfect_3', name: 'Perfectionist', description: 'Serve 3 perfect dishes in a game', unlockedAt: Date.now() });
    }
    if (player.perfectDishes >= 5 && !stats.achievements.some(a => a.id === 'perfect_5')) {
        newAchievements.push({ id: 'perfect_5', name: 'Flawless Cook', description: 'Serve 5 perfect dishes in a game', unlockedAt: Date.now() });
    }
    if (player.perfectDishes >= 8 && !stats.achievements.some(a => a.id === 'perfect_8')) {
        newAchievements.push({ id: 'perfect_8', name: 'Perfect Master', description: 'Serve 8 perfect dishes in a game', unlockedAt: Date.now() });
    }
    if (player.perfectDishes >= 12 && !stats.achievements.some(a => a.id === 'perfect_12')) {
        newAchievements.push({ id: 'perfect_12', name: 'Precision Expert', description: 'Serve 12 perfect dishes in a game', unlockedAt: Date.now() });
    }
    if (player.perfectDishes >= 15 && !stats.achievements.some(a => a.id === 'perfect_15')) {
        newAchievements.push({ id: 'perfect_15', name: 'Perfection Incarnate', description: 'Serve 15 perfect dishes in a game', unlockedAt: Date.now() });
    }

    // Games Played (5 levels) - check after incrementing
    if (stats.gamesPlayed >= 10 && !stats.achievements.some(a => a.id === 'games_10')) {
        newAchievements.push({ id: 'games_10', name: 'Veteran Chef', description: 'Play 10 games', unlockedAt: Date.now() });
    }
    if (stats.gamesPlayed >= 25 && !stats.achievements.some(a => a.id === 'games_25')) {
        newAchievements.push({ id: 'games_25', name: 'Seasoned Pro', description: 'Play 25 games', unlockedAt: Date.now() });
    }
    if (stats.gamesPlayed >= 50 && !stats.achievements.some(a => a.id === 'games_50')) {
        newAchievements.push({ id: 'games_50', name: 'Kitchen Legend', description: 'Play 50 games', unlockedAt: Date.now() });
    }
    if (stats.gamesPlayed >= 100 && !stats.achievements.some(a => a.id === 'games_100')) {
        newAchievements.push({ id: 'games_100', name: 'Culinary Master', description: 'Play 100 games', unlockedAt: Date.now() });
    }
    if (stats.gamesPlayed >= 200 && !stats.achievements.some(a => a.id === 'games_200')) {
        newAchievements.push({ id: 'games_200', name: 'Eternal Chef', description: 'Play 200 games', unlockedAt: Date.now() });
    }

    return newAchievements;
}

// ============ USER MANAGEMENT ============
let users = {};

function generateUID() {
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += Math.floor(Math.random() * 10);
    }
    // Ensure uniqueness
    const exists = Object.values(users).some(u => u.uid === result);
    if (exists) return generateUID();
    return result;
}

async function loadUsers() {
    // 1. If Firebase is active, sync from Cloud Firestore
    if (db) {
        try {
            console.log('🔄 Syncing users from Cloud Firestore...');
            const snapshot = await db.collection('users').get();
            
            if (snapshot.empty) {
                console.log('📭 No users found in Firestore (empty collection)');
            } else {
                snapshot.forEach(doc => {
                    const userData = doc.data();
                    users[doc.id] = userData;
                    console.log(`✅ Loaded user: ${doc.id} (${userData.username || userData.name})`);
                });
                console.log(`🌐 Synced ${snapshot.size} users from Cloud Firestore.`);
            }
        } catch (e) {
            console.error('❌ CRITICAL: Error syncing from Firestore:', e.message || e);
            console.error('Full error:', e);
            
            // If authentication fails, disable Firebase
            if (e.message && e.message.includes('UNAUTHENTICATED')) {
                console.error('🔥 Firebase authentication failed - invalid or expired credentials');
                console.error('Please check your serviceAccountKey.json file');
                db = null; // Disable Firebase
            }
        }
    } else {
        console.warn('⚠️ Firebase not connected. User registration and persistence will be disabled.');
    }


    // 4. Ensure all accounts have a numeric UID, Level, and XP
    let updated = false;
    for (const id of Object.keys(users)) {
        if (users[id].type === 'account') {
            let userUpdated = false;
            if (!users[id].uid) {
                users[id].uid = generateUID();
                userUpdated = true;
                console.log(`🆔 Assigned UID ${users[id].uid} to user ${users[id].username || id}`);
            }
            if (users[id].level === undefined) {
                users[id].level = 1;
                userUpdated = true;
            }
            if (users[id].xp === undefined) {
                users[id].xp = 0;
                userUpdated = true;
            }
            if (!users[id].stats) {
                users[id].stats = {};
                userUpdated = true;
            }
            // Add missing stat fields
            if (users[id].stats.wins === undefined) {
                users[id].stats.wins = 0;
                userUpdated = true;
            }
            if (users[id].stats.bestStreak === undefined) {
                users[id].stats.bestStreak = 0;
                userUpdated = true;
            }
            if (users[id].stats.perfectDishes === undefined) {
                users[id].stats.perfectDishes = 0;
                userUpdated = true;
            }
            if (users[id].stats.dishesServed === undefined) {
                users[id].stats.dishesServed = 0;
                userUpdated = true;
            }
            if (users[id].stats.gamesPlayed === undefined) {
                users[id].stats.gamesPlayed = 0;
                userUpdated = true;
            }
            if (users[id].stats.coopGames === undefined) {
                users[id].stats.coopGames = 0;
                userUpdated = true;
            }
            if (users[id].stats.itemsChopped === undefined) {
                users[id].stats.itemsChopped = 0;
                userUpdated = true;
            }
            if (users[id].stats.itemsCooked === undefined) {
                users[id].stats.itemsCooked = 0;
                userUpdated = true;
            }
            if (users[id].stats.burntFood === undefined) {
                users[id].stats.burntFood = 0;
                userUpdated = true;
            }
            if (users[id].stats.failedOrders === undefined) {
                users[id].stats.failedOrders = 0;
                userUpdated = true;
            }
            if (users[id].stats.scoreTotal === undefined) {
                users[id].stats.scoreTotal = 0;
                userUpdated = true;
            }
            if (!users[id].stats.achievements) {
                users[id].stats.achievements = [];
                userUpdated = true;
            }
            if (!users[id].stats.gameScores) {
                users[id].stats.gameScores = [];
                userUpdated = true;
            }

            if (userUpdated) {
                try {
                    await persistUser(id);
                    updated = true;
                } catch (e) {
                    console.error(`[Init] Failed to update user ${id} in Cloud:`, e.message || e);
                }
            }
        }
    }

    if (updated) {
        console.log(`✅ All user UIDs, Levels, and XP have been synced.`);
    }
    
    // Log final user count
    const accountCount = Object.values(users).filter(u => u.type === 'account').length;
    const guestCount = Object.values(users).filter(u => u.type === 'guest').length;
    console.log(`👥 Total users loaded: ${accountCount} accounts, ${guestCount} guests`);
}

async function saveUserToCloud(userId, userData) {
    if (!db) {
        throw new Error("Firestore not initialized");
    }
    if (userData.type === 'guest') return;

    console.log(`[CloudSave] Attempting to save user ${userId} to Firestore...`);
    await db.collection('users').doc(userId).set(userData);
    console.log(`[CloudSave] Success! User ${userId} saved to Cloud.`);
}

// Global save helper
async function persistUser(userId) {
    if (users[userId] && users[userId].type === 'account') {
        await saveUserToCloud(userId, users[userId]);
    }
}

// ============ STARTUP ============
async function startServer() {
    console.log('🏁 Starting Cooking Battle Server...');
    await loadUsers();

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`
    ╔═══════════════════════════════════════════╗
    ║  🍳  COOKING BATTLE - GAME SERVER  🍳     ║
    ║  Server running on port ${PORT}             ║
    ║  http://localhost:${PORT}                   ║
    ║  Chopping Speed: 2.5s (Veggies) / 4.5s (Meat) ║
    ╚═══════════════════════════════════════════╝
        `);
    });
}

startServer();

// ============ GAME CONFIGURATION ============
const TILE_SIZE = 2;
const GRID_W = 14;
const GRID_H = 10;
const GAME_DURATION = 300;
const ORDER_INTERVAL = 15000; // Slower orders (Easier)
const ORDER_TIMEOUT = 60000; // Longer expiration (Easier)
const MAX_ORDERS = 6;
const TICK_RATE = 100; // 10 ticks/sec

// Player visual defaults
const PLAYER_COLORS = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF'];
const PLAYER_EMOJIS = ['👨‍🍳', '👩‍🍳', '🧑‍🍳', '👨‍🍳'];

// ============ RECIPE DEFINITIONS ============
const INGREDIENTS = {
    tomato: { name: 'Tomato', color: '#e74c3c', emoji: '🍅', chopTime: 1000 },
    lettuce: { name: 'Lettuce', color: '#2ecc71', emoji: '🥬', chopTime: 1000 },
    meat: { name: 'Meat', color: '#a0522d', emoji: '🥩', chopTime: 1000 },
    cheese: { name: 'Cheese', color: '#f1c40f', emoji: '🧀', chopTime: 1000 },
    bread: { name: 'Bread', color: '#d4a574', emoji: '🍞', chopTime: 0 },
    dough: { name: 'Dough', color: '#f5f6fa', emoji: '⚪', chopTime: 0, rollTime: 1000 },
    fish: { name: 'Fish', color: '#3498db', emoji: '🐟', chopTime: 1000 },
    rice: { name: 'Rice', color: '#ecf0f1', emoji: '🍚', chopTime: 0, requiresWashing: true, washTime: 1000 },
    onion: { name: 'Onion', color: '#0cef8dc1', emoji: '🧅', chopTime: 1000 },
    mushroom: { name: 'Mushroom', color: '#8B7355', emoji: '🍄', chopTime: 1000 },
    egg: { name: 'Egg', color: '#FFEFD5', emoji: '🥚', chopTime: 0 },
};

const RECIPES = {
    burger: {
        name: 'Burger',
        emoji: '🍔',
        ingredients: ['bread', 'meat', 'lettuce', 'tomato'],
        requiresChopping: ['meat', 'lettuce', 'tomato'],
        requiresCooking: ['meat'],
        cookTime: 3000,
        points: 30,
        tip: 10,
        color: '#D4A574'
    },
    salad: {
        name: 'Salad',
        emoji: '🥗',
        ingredients: ['lettuce', 'tomato', 'onion'],
        requiresChopping: ['lettuce', 'tomato', 'onion'],
        requiresCooking: [],
        cookTime: 0,
        points: 20,
        tip: 5,
        color: '#27ae60'
    },
    sushi: {
        name: 'Sushi',
        emoji: '🍣',
        ingredients: ['rice', 'fish'],
        requiresChopping: ['fish'],
        requiresWashing: ['rice'],
        requiresCooking: ['rice'],
        cookTime: 3000,
        points: 35,
        tip: 15,
        color: '#e74c3c'
    },
    pizza: {
        name: 'Pizza',
        emoji: '🍕',
        ingredients: ['dough', 'tomato', 'cheese'],
        requiresChopping: ['tomato', 'cheese'],
        requiresRolling: ['dough'], // Use ROLLER first
        requiresCooking: ['dough'], // Then OVEN
        cookTime: 3000,
        points: 50,
        tip: 20,
        color: '#e67e22'
    },
    soup: {
        name: 'Soup',
        emoji: '🍲',
        ingredients: ['tomato', 'onion', 'mushroom'],
        requiresChopping: ['tomato', 'onion', 'mushroom'],
        requiresCooking: ['tomato', 'onion', 'mushroom'],
        cookTime: 3000,
        points: 35,
        tip: 10,
        color: '#c0392b'
    },
    omelette: {
        name: 'Omelette',
        emoji: '🍳',
        ingredients: ['egg', 'cheese', 'mushroom'],
        requiresChopping: ['mushroom'],
        requiresCooking: ['egg'],
        cookTime: 3000,
        points: 25,
        tip: 8,
        color: '#f39c12'
    },
    steak_mushroom: {
        name: 'Steak & Mushroom',
        emoji: '🥩🍄',
        ingredients: ['meat', 'mushroom', 'onion'],
        requiresChopping: ['meat', 'mushroom', 'onion'],
        requiresCooking: ['meat', 'mushroom', 'onion'],
        cookTime: 3000,
        points: 45,
        tip: 15,
        color: '#8B4513'
    },
    fish_tacos: {
        name: 'Fish Tacos',
        emoji: '🌮',
        ingredients: ['fish', 'lettuce', 'tomato', 'bread'],
        requiresChopping: ['fish', 'lettuce', 'tomato'],
        requiresCooking: ['fish'],
        cookTime: 3000,
        points: 40,
        tip: 12,
        color: '#FFD700'
    }
};

// ============ KITCHEN LAYOUT GENERATOR ============

function getRequiredStations(ingredients, recipes, difficulty) {
    const stations = [];
    const ingList = Object.keys(ingredients);

    // 1. Ingredient Crates
    ingList.forEach(ing => stations.push({ type: 'crate', ingredient: ing }));

    // 2. Processing Stations - Optimized for difficulty
    const count = (difficulty === 'easy') ? 1 : 2;

    for (let i = 0; i < count; i++) stations.push({ type: 'chopping', id: `chop${i}` });
    for (let i = 0; i < count; i++) stations.push({ type: 'stove', id: `stove${i}` });
    for (let i = 0; i < count; i++) stations.push({ type: 'oven', id: `oven${i + 1}` });
    for (let i = 0; i < count; i++) stations.push({ type: 'roller', id: `roller${i + 1}` });

    stations.push({ type: 'sink', id: 'sink1' });
    stations.push({ type: 'plates', id: 'plates1' });
    if (difficulty !== 'easy') {
        stations.push({ type: 'sink', id: 'sink2' });
        stations.push({ type: 'plates', id: 'plates2' });
    }

    stations.push({ type: 'serve', id: 'serve1' });
    stations.push({ type: 'trash', id: 'trash1' });

    // 3. Special Stations - Seasoning Counters
    stations.push({ type: 'seasoning', id: 'seasoning_salt', ingredient: 'salt', canSpawn: true });
    stations.push({ type: 'seasoning', id: 'seasoning_sauce', ingredient: 'sauce', canSpawn: true });

    return stations;
}

function generateLayout(width, height, ingredientSet, activeRecipes, difficulty) {
    const layout = Array.from({ length: height }, () => new Array(width).fill(0));
    const stations = getRequiredStations(ingredientSet, activeRecipes, difficulty);

    // Filter stations into groups
    const crates = stations.filter(s => s.type === 'crate');
    // TOOLS: stove, chopping, oven, roller, sink - these get randomized positions
    const tools = stations.filter(s => ['stove', 'chopping', 'oven', 'roller', 'sink'].includes(s.type));
    const seasoning = stations.filter(s => s.type === 'seasoning');
    const utility = stations.filter(s => !['crate', 'stove', 'chopping', 'oven', 'roller', 'sink', 'counter', 'seasoning'].includes(s.type));

    // Define perimeter but skip corners
    let slots = [];
    for (let x = 1; x < width - 1; x++) { slots.push({ x, z: 0 }); slots.push({ x, z: height - 1 }); }
    for (let z = 1; z < height - 1; z++) { slots.push({ x: 0, z }); slots.push({ x: width - 1, z }); }

    // Shuffle slots
    slots = slots.sort(() => Math.random() - 0.5);

    // --- 1. ISLAND GENERATION (Center kitchen) ---
    const midX = Math.floor(width / 2);
    const midZ = Math.floor(height / 2);
    const islandSlots = [];

    if (width > 6 && height > 6) {
        if (difficulty === 'hard') {
            // DOUBLE ISLAND STRUCTURE for Hard Mode
            // Two parallel horizontal islands to fill the massive 14x10 space
            const islandRows = [midZ - 2, midZ + 2];
            islandRows.forEach(row => {
                for (let x = midX - 2; x <= midX + 2; x++) {
                    if (x > 0 && x < width - 1) {
                        islandSlots.push({ x, z: row });
                        layout[row][x] = { type: 'counter', id: `island_${x}_${row}` };
                    }
                }
            });
        } else {
            // Simple 1x1 island for Easy
            islandSlots.push({ x: midX, z: midZ });
            layout[midZ][midX] = { type: 'counter', id: `island_${midX}_${midZ}` };
        }
    }

    // --- 2. PLACE SEASONING ON ISLAND OR PERIMETER ---
    // High probability for Hard mode to use the new industrial islands
    const seasoningProbability = (difficulty === 'hard') ? 0.8 : 0.3;
    seasoning.forEach(st => {
        if (islandSlots.length > 0 && Math.random() < seasoningProbability) {
            const pos = islandSlots.pop();
            layout[pos.z][pos.x] = st;
        } else if (slots.length > 0) {
            const pos = slots.pop();
            layout[pos.z][pos.x] = st;
        }
    });

    // --- 3. UTILITY STATIONS (Trash, Serve, Plates) ---
    const bottomWallSlots = slots.filter(p => p.z === height - 1).sort((a, b) => a.x - b.x);
    utility.forEach((u, i) => {
        if (i < bottomWallSlots.length) {
            const pos = bottomWallSlots[i];
            layout[pos.z][pos.x] = u;
            slots = slots.filter(s => !(s.x === pos.x && s.z === pos.z));
        } else if (slots.length > 0) {
            const pos = slots.pop();
            layout[pos.z][pos.x] = u;
        }
    });

    // --- 4. CRATES (Ingredients) ---
    crates.forEach((crate) => {
        if (slots.length > 0) {
            const pos = slots.pop();
            layout[pos.z][pos.x] = crate;
        }
    });

    // --- 5. TOOLS (Stove, Chopping, Oven, Roller, Sink) ---
    // Distribute tools between islands and perimeter in Hard mode
    tools.forEach(st => {
        if (difficulty === 'hard' && islandSlots.length > 0 && Math.random() > 0.3) {
            const pos = islandSlots.pop();
            layout[pos.z][pos.x] = st;
        } else if (slots.length > 0) {
            const pos = slots.pop();
            layout[pos.z][pos.x] = st;
        }
    });

    // --- 6. FILL REMAINING PERIMETER ---
    // Fixed: high fill rate for Hard mode
    const fillRate = (difficulty === 'hard') ? 0.05 : 0.3;
    slots.forEach(pos => {
        if (Math.random() > fillRate) {
            layout[pos.z][pos.x] = { type: 'counter', id: `c_${pos.x}_${pos.z}` };
        }
    });

    // Add Corners always
    layout[0][0] = { type: 'counter', id: 'corner1' };
    layout[0][width - 1] = { type: 'counter', id: 'corner2' };
    layout[height - 1][0] = { type: 'counter', id: 'corner3' };
    layout[height - 1][width - 1] = { type: 'counter', id: 'corner4' };

    return layout;
}

// ============ GAME STATE ============
const rooms = {};
const roomCodes = {};
const friends = {};
const roomCodeToId = {};
const socketToUser = {}; // Map socket.id to userId
const userToSocket = {}; // Map userId to socket.id (for single device enforcement)
const disconnectedPlayers = {}; // Track disconnected players: { userId: { roomId, gameSessionId, playerData, disconnectTime } }

// ============ USER STATUS HELPERS ============
function getUserStatus(userId) {
    const socketId = userToSocket[userId];
    if (!socketId) return 'offline';

    // Check if socket actually exists and is connected
    const socket = io.sockets.sockets.get(socketId);
    if (!socket || !socket.connected) return 'offline';

    const player = findPlayer(socketId);
    if (player) {
        const room = rooms[player.roomId];
        if (room) {
            // playing -> ingame
            // lobby or gameover -> lobby
            const status = (room.state === 'playing') ? 'ingame' : 'lobby';
            console.log(`[Status] User ${userId} is ${status} (Room: ${player.roomId}, State: ${room.state})`);
            return status;
        }
    }

    console.log(`[Status] User ${userId} is online (no room found)`);
    return 'online';
}

function broadcastStatusUpdate(userId) {
    const user = users[userId];
    if (!user || !user.friends) return;

    const status = getUserStatus(userId);
    const name = user.username || user.name;

    user.friends.forEach(friendId => {
        const friendSocketId = userToSocket[friendId];
        if (friendSocketId) {
            const friendSocket = io.sockets.sockets.get(friendSocketId);
            if (friendSocket) {
                friendSocket.emit('friendStatusUpdate', {
                    userId: userId,
                    name: name,
                    status: status
                });
            }
        }
    });
}

function buildRoomListPayload(currentUserId = null) {
    const allRooms = Object.values(rooms);

    return allRooms.map(r => {
        const activePlayers = Object.keys(r.players).length;
        const maxPlayers = r.mode === 'single' ? 1 : r.mode === 'multi_vs' ? 2 : 3;

        // ── Determine if this user has a valid reconnect slot for this room ──
        let canReconnect = false;
        if (currentUserId && disconnectedPlayers[currentUserId]) {
            const rd = disconnectedPlayers[currentUserId];
            if (rd.roomId === r.id) {
                // Room must still exist and not be finished
                const gameNotOver = r.state !== 'gameover' && r.state !== 'finished';
                // Session must match: if no session was saved yet (lobby disconnect)
                // or the saved session equals the current session
                const sessionOk = !rd.gameSessionId || rd.gameSessionId === r.gameSessionId;

                if (gameNotOver && sessionOk) {
                    canReconnect = true;
                } else {
                    // Only purge entry if game provably ended or a brand-new session started
                    const isStale = !gameNotOver ||
                        (rd.gameSessionId && r.gameSessionId && rd.gameSessionId !== r.gameSessionId);
                    if (isStale) {
                        console.log(`🗑️ Purging stale reconnect slot for ${currentUserId} (game ended or new session)`);
                        delete disconnectedPlayers[currentUserId];
                    }
                    // canReconnect stays false
                }
            }
        }

        // ── VISIBILITY LOGIC ──
        // Only show the room if:
        // 1. This specific user has a valid reconnect slot (canReconnect === true)
        // 2. OR the room has active players (not a ghost room)
        const shouldShow = canReconnect || activePlayers > 0;
        if (!shouldShow) return null;

        return {
            id: r.id,
            mode: r.mode,
            difficulty: r.difficulty,
            players: activePlayers,
            maxPlayers,
            state: r.state,
            hasPassword: r.hasPassword,
            canReconnect
        };
    }).filter(Boolean);
}

// Clean up stale reconnection data (older than 30 minutes)
function cleanupStaleReconnectData() {
    const now = Date.now();
    const staleTimeout = 30 * 60 * 1000; // 30 minutes

    Object.keys(disconnectedPlayers).forEach(userId => {
        const data = disconnectedPlayers[userId];
        if (now - data.disconnectTime > staleTimeout) {
            delete disconnectedPlayers[userId];
            console.log(`🗑️ Cleaned up stale reconnect data for user ${userId}`);
        }
    });
}

// Run cleanup every 10 minutes
setInterval(cleanupStaleReconnectData, 10 * 60 * 1000);

function broadcastRoomList() {
    // Send personalized room list to each connected socket
    io.sockets.sockets.forEach((socket) => {
        const userId = socketToUser[socket.id];
        socket.emit('roomList', buildRoomListPayload(userId));
    });
}

function selectContent(difficulty) {
    const allRecipes = Object.keys(RECIPES);
    let selectedRecipes = [];
    let requiredIngredients = new Set();

    if (difficulty === 'easy') {
        // Pick 2 random recipes
        while (selectedRecipes.length < 2) {
            const r = allRecipes[Math.floor(Math.random() * allRecipes.length)];
            if (!selectedRecipes.includes(r)) selectedRecipes.push(r);
        }
    } else {
        // Hard: 5 recipes (or all if less)
        selectedRecipes = allRecipes.slice(0, 5);
        // Shuffle if you want randomness:
        // selectedRecipes = allRecipes.sort(() => 0.5 - Math.random()).slice(0, 5);
    }

    // Gather ingredients
    selectedRecipes.forEach(rName => {
        RECIPES[rName].ingredients.forEach(i => requiredIngredients.add(i));
    });

    // If Easy mode needs exactly 6 ingredients and we have less, add random ones?
    if (difficulty === 'easy') {
        const allIngKeys = Object.keys(INGREDIENTS);
        const currentCount = requiredIngredients.size;
        if (currentCount < 6) {
            const missing = 6 - currentCount;
            const available = allIngKeys.filter(ing => !requiredIngredients.has(ing));
            for (let i = 0; i < missing && available.length > 0; i++) {
                const randomIng = available.splice(Math.floor(Math.random() * available.length), 1)[0];
                requiredIngredients.add(randomIng);
            }
        }
    }

    // Map back to objects (after adding fillers)
    const finalRecipes = {};
    selectedRecipes.forEach(r => finalRecipes[r] = RECIPES[r]);

    const finalIngredients = {};
    requiredIngredients.forEach(i => {
        if (INGREDIENTS[i]) finalIngredients[i] = INGREDIENTS[i];
    });

    return { recipes: finalRecipes, ingredients: finalIngredients };
}

function isValidSpawn(room, x, z) {
    const gw = room.config.GRID_W;
    const gh = room.config.GRID_H;
    if (x < 0 || x >= gw || z < 0 || z >= gh) return false;
    // Must be floor (0)
    if (room.kitchen[z][x] !== 0) return false;

    // Check if any player is already here (grid-aligned check)
    const occupied = Object.values(room.players).some(p =>
        Math.abs(p.gridX - x) < 0.5 && Math.abs(p.gridZ - z) < 0.5
    );
    return !occupied;
}

function findSafeSpawn(room, targetX, targetZ) {
    const gw = room.config.GRID_W;
    const gh = room.config.GRID_H;

    // Check target first
    if (isValidSpawn(room, targetX, targetZ)) {
        return { x: targetX, z: targetZ };
    }

    // Spiral search for nearest floor tile
    const maxDist = Math.max(gw, gh);
    for (let d = 1; d < maxDist; d++) {
        for (let x = targetX - d; x <= targetX + d; x++) {
            for (let z = targetZ - d; z <= targetZ + d; z++) {
                // Perimeter only for this distance level
                if (x === targetX - d || x === targetX + d || z === targetZ - d || z === targetZ + d) {
                    if (isValidSpawn(room, x, z)) {
                        return { x, z };
                    }
                }
            }
        }
    }
    // Fallback to original if absolutely no space found (unlikely)
    return { x: targetX, z: targetZ };
}

function generateRoomCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (roomCodeToId[code]);
    return code;
}

function createRoom(roomId, settings) {
    const diff = settings.difficulty || 'easy';
    const mode = settings.mode || 'single';

    let layout = null;
    let w, h;
    let content = { recipes: {}, ingredients: {} };

    // Generate room code
    const roomCode = generateRoomCode();
    roomCodeToId[roomCode] = roomId;

    // 1. Try to load custom map
    let mapLoaded = false;
    const mapPriorities = [];
    if (mode === 'multi_coop') mapPriorities.push('multi_coop');
    mapPriorities.push(diff);

    for (const mapName of mapPriorities) {
        const p = path.join(__dirname, 'maps', `${mapName}.json`);
        try {
            if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p, 'utf8');
                const data = JSON.parse(raw);
                if (data.layout) {
                    layout = data.layout;
                    w = data.width || layout[0].length;
                    h = data.height || layout.length;
                    console.log(`🗺️  Loaded custom map: ${mapName} for room ${roomId}`);
                    mapLoaded = true;
                    break;
                }
            }
        } catch (e) {
            console.error(`Failed to load map ${mapName}:`, e);
        }
    }

    // 2. Setup content (Recipes/Ingredients)
    // First, determine recipes based on difficulty
    content = selectContent(diff);

    if (mapLoaded) {
        // If map is custom, we need to populate the 'crate' stations with actual ingredients
        // based on the selected content.
        const requiredIngs = Object.keys(content.ingredients);
        let crateSlots = [];

        // Find all crate slots in the layout
        for (let z = 0; z < h; z++) {
            for (let x = 0; x < w; x++) {
                const cell = layout[z][x];
                if (cell && cell.type === 'crate') {
                    crateSlots.push({ x, z, id: cell.id });
                }
            }
        }

        // Shuffle crate slots to randomize placement
        crateSlots = crateSlots.sort(() => Math.random() - 0.5);

        // Assign ingredients to crates
        crateSlots.forEach((slot, i) => {
            // Loop through required ingredients based on slot index
            // If we have more crates than ingredients, repeat them
            if (requiredIngs.length > 0) {
                const ingName = requiredIngs[i % requiredIngs.length];
                // Update the layout cell directly with the specific ingredient
                layout[slot.z][slot.x].ingredient = ingName;
            } else {
                // Fallback if no ingredients (shouldn't happen)
                layout[slot.z][slot.x].ingredient = 'tomato';
            }
        });

    } else {
        // Standard procedural generation
        w = (diff === 'easy') ? 7 : 14;
        h = (diff === 'easy') ? 7 : 10;
        layout = generateLayout(w, h, content.ingredients, content.recipes, diff);
    }

    // Build stations map & Extract Spawn Points
    const stations = {};
    const spawns = {}; // Store { 1: {x,z}, 2: {x,z}, ... }

    for (let z = 0; z < h; z++) {
        for (let x = 0; x < w; x++) {
            const cell = layout[z][x];
            if (cell && typeof cell === 'object') {

                // Identify Spawn Points
                if (cell.type && cell.type.startsWith('spawn_')) {
                    const num = parseInt(cell.type.split('_')[1]);
                    spawns[num] = { x, z };
                    // Replace spawn marker with floor so it's walkable
                    layout[z][x] = 0;
                    continue; // Skip adding to stations
                }

                // Ensure ID is unique per cell if not already
                // If map loaded from JSON, ID might be reused from edit session.
                // We should append coordinates to be safe if it's generic?
                // But admin tool generates unique IDs.
                // Just use cell.id if present.
                const id = cell.id || `${cell.type}_${x}_${z}`;
                stations[id] = {
                    ...cell,
                    id: id,
                    gridX: x,
                    gridZ: z,
                    contents: null,
                    cookProgress: 0,
                    chopProgress: 0,
                    washProgress: 0,
                    isBurning: false,
                    isDirty: false,
                    plateReady: cell.type === 'plates',
                };
                // Update layout ref
                cell.id = id;
            }
        }
    }

    return {
        id: roomId,
        players: {},
        kitchen: layout,
        stations: stations,
        spawns: spawns, // Add spawns to room object
        orders: [],
        score: 0,
        combo: 0,
        maxCombo: 0,
        perfectDishes: 0,
        timeLeft: GAME_DURATION,
        state: 'lobby',
        mode: mode,
        difficulty: diff,
        activeRecipes: content.recipes,
        activeIngredients: content.ingredients,
        droppedItems: {},
        config: {
            TILE_SIZE,
            GRID_W: w,
            GRID_H: h
        },
        countdownTimer: null,
        isStarting: false,
        gameStartAt: null,
        gameSessionId: null, // Unique ID for each game session
        orderTimer: null,
        gameTimer: null,
        tickTimer: null,
        ordersCompleted: 0,
        ordersFailed: 0,
        highScore: 0,
        roomCode: roomCode,
        password: settings.password || null,
        hasPassword: !!settings.password,
        isPaused: false,
        pausedAt: null,
    };
}

function getOrCreateRoom(roomId, settings = {}) {
    let room = rooms[roomId];

    // Only create new room if it doesn't exist
    // Same room ID = same room state (don't regenerate if room exists)
    if (!room) {
        console.log(`🆕 Creating new room ${roomId} (Mode: ${settings.mode || 'default'}, Diff: ${settings.difficulty || 'default'})`);
        rooms[roomId] = createRoom(roomId, settings);
        room = rooms[roomId];
    } else {
        // Room exists - verify settings match (if different, reject or use existing)
        if (settings.mode && room.mode !== settings.mode) {
            console.log(`⚠️  Room ${roomId} exists with mode ${room.mode}, but requested ${settings.mode}. Using existing room.`);
        }
        if (settings.difficulty && room.difficulty !== settings.difficulty) {
            console.log(`⚠️  Room ${roomId} exists with difficulty ${room.difficulty}, but requested ${settings.difficulty}. Using existing room.`);
        }
    }

    return room;
}

// ============ ORDER MANAGEMENT ============
function generateOrder(room) {
    if (room.orders.length >= MAX_ORDERS) return;

    // Use only active recipes for this room
    const recipeKeys = Object.keys(room.activeRecipes);
    if (recipeKeys.length === 0) return;

    const recipeKey = recipeKeys[Math.floor(Math.random() * recipeKeys.length)];
    const recipe = room.activeRecipes[recipeKey];

    const order = {
        id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        recipe: recipeKey,
        createdAt: Date.now(),
        expiresAt: Date.now() + ORDER_TIMEOUT,
        points: recipe.points,
        tip: recipe.tip,
    };

    room.orders.push(order);
    return order;
}

function checkOrderExpiry(room) {
    const now = Date.now();
    const expired = room.orders.filter(o => now >= o.expiresAt);
    expired.forEach(o => {
        room.orders = room.orders.filter(ord => ord.id !== o.id);
        room.combo = 0;
        room.ordersFailed++;
        io.to(room.id).emit('orderExpired', { orderId: o.id, score: room.score });
    });
}

// ============ RECIPE MATCHING ============
function checkPlateMatchesOrder(plateContents, room) {
    if (!plateContents || !plateContents.ingredients || plateContents.burnt) return null;

    const plateIngs = [...plateContents.ingredients].sort();

    for (const order of room.orders) {
        const recipeKey = order.recipe;
        const recipe = room.activeRecipes[recipeKey];
        const recipeIngs = [...recipe.ingredients].sort();

        if (plateIngs.length === recipeIngs.length &&
            plateIngs.every((ing, i) => ing === recipeIngs[i])) {
            let penalty = 0;

            const requiresChopping = recipe.requiresChopping || [];
            if (requiresChopping.length > 0) {
                const missingChop = requiresChopping.some(ing =>
                    !plateContents.chopped || !plateContents.chopped.includes(ing)
                );
                if (missingChop) penalty += 10;
            }

            const requiresCooking = recipe.requiresCooking || [];
            if (requiresCooking.length > 0) {
                const missingCook = requiresCooking.some(ing =>
                    !plateContents.cooked || !plateContents.cooked.includes(ing)
                );
                if (missingCook) penalty += 10;
            }

            const requiresRolling = recipe.requiresRolling || [];
            if (requiresRolling.length > 0) {
                const missingRoll = requiresRolling.some(ing =>
                    !plateContents.rolled || !plateContents.rolled.includes(ing)
                );
                if (missingRoll) penalty += 10;
            }

            const requiresWashing = recipe.requiresWashing || [];
            if (requiresWashing.length > 0) {
                const missingWash = requiresWashing.some(ing =>
                    !plateContents.washed || !plateContents.washed.includes(ing)
                );
                if (missingWash) penalty += 10;
            }

            const typeBDishes = ['soup', 'omelette', 'steak_mushroom', 'pizza'];
            if (typeBDishes.includes(recipeKey) && !plateContents.cookedPlate) {
                penalty += 10;
            }

            if (recipeKey === 'sushi' && plateContents.cooked && plateContents.cooked.includes('fish')) {
                penalty += 10;
            }

            const basePoints = order.points;
            const effectiveBasePoints = Math.max(basePoints - penalty, 0);

            return {
                order,
                recipeKey,
                recipe,
                basePoints,
                processPenalty: penalty,
                effectiveBasePoints,
            };
        }
    }
    return null;
}

// ============ SOCKET HANDLING ============
io.on('connection', (socket) => {
    console.log(`🍳 Chef connected: ${socket.id}`);

    socket.emit('roomList', buildRoomListPayload(socketToUser[socket.id]));

    socket.on('getRooms', () => {
        socket.emit('roomList', buildRoomListPayload(socketToUser[socket.id]));
    });

    socket.on('register', async (data) => {
        const { username, password } = data;
        const userId = 'user_' + username.toLowerCase();

        if (!db) {
            return socket.emit('loginError', { msg: 'Database not connected. Registration unavailable.' });
        }

        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                return socket.emit('loginError', { msg: 'Username already taken!' });
            }
        } catch (e) {
            console.error('Error checking username in Firestore:', e.message || e);
            return socket.emit('loginError', { msg: 'Database connection error. Please try again later.' });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = {
                id: userId,
                uid: generateUID(),
                username: username,
                name: username, // Default display name
                type: 'account',
                password: hashedPassword,
                createdAt: Date.now(),
                level: 1,
                xp: 0,
                stats: {
                    gamesPlayed: 0,
                    scoreTotal: 0,
                    dishesServed: 0,
                    perfectDishes: 0,
                    wins: 0,
                    bestStreak: 0,
                    itemsChopped: 0,
                    itemsCooked: 0,
                    burntFood: 0,
                    failedOrders: 0,
                    chefHatPoints: 0,
                    gameScores: [],
                    achievements: []
                },
                profileImage: 'chef_1', // Default profile image
                profileColor: '#FF6B6B', // Default profile color
                title: '', // Custom title
                bio: '' // Profile bio
            };

            // STRICT: Save to cloud first
            await saveUserToCloud(userId, newUser);

            // Only update local cache if cloud save succeeded
            users[userId] = newUser;

            socket.emit('registerSuccess', { msg: 'Account created! Please login now.' });
            console.log(`🆕 New User Registered (Firebase): ${username}`);
        } catch (e) {
            console.error('Registration error:', e.message || e);
            socket.emit('loginError', { msg: 'Server/Database error during registration. Account could not be saved to Cloud.' });
        }
    });

    socket.on('userLogin', async (data) => {
        const { username, password, autoLogin, userId } = data;

        // ── Helper: finalize login for an account userId ──
        const finalizeAccountLogin = (uid, user) => {
            // Kick duplicate session
            if (userToSocket[uid] && userToSocket[uid] !== socket.id) {
                const old = io.sockets.sockets.get(userToSocket[uid]);
                if (old) {
                    old.emit('forceLogout', { msg: 'Your account was logged in from another device.' });
                    old.disconnect(true);
                }
            }
            socketToUser[socket.id] = uid;
            userToSocket[uid] = socket.id;
            const clone = { ...user };
            delete clone.password;
            socket.emit('loginSuccess', clone);
            // Send personalized room list immediately so reconnect button shows up
            socket.emit('roomList', buildRoomListPayload(uid));
            broadcastStatusUpdate(uid);
            console.log(`👤 Account login: ${uid}`);
        };

        // Handle auto-login from localStorage
        if (autoLogin && userId) {
            console.log(`🔐 Auto-login attempt for userId: ${userId}`);
            const user = users[userId];
            if (user && user.type === 'account') {
                console.log(`✅ Auto-login successful for: ${userId}`);
                finalizeAccountLogin(userId, user);
                return;
            } else {
                console.log(`❌ Auto-login failed - user not found or not account type: ${userId}`);
                // Send error to clear invalid localStorage
                return socket.emit('loginError', { msg: 'Session expired. Please login again.', clearStorage: true });
            }
        }

        // Regular login with username/password
        if (!username || !password) {
            return socket.emit('loginError', { msg: 'Username and password required!' });
        }

        const calculatedUserId = 'user_' + username.toLowerCase();
        console.log(`🔐 Login attempt for username: ${username}, userId: ${calculatedUserId}`);
        
        const user = users[calculatedUserId];
        if (!user || user.type !== 'account') {
            console.log(`❌ User not found: ${calculatedUserId}`);
            return socket.emit('loginError', { msg: 'User not found!' });
        }

        try {
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                console.log(`✅ Password match for: ${calculatedUserId}`);
                finalizeAccountLogin(calculatedUserId, user);
            } else {
                console.log(`❌ Invalid password for: ${calculatedUserId}`);
                socket.emit('loginError', { msg: 'Invalid password!' });
            }
        } catch (e) {
            console.error('Login error:', e);
            socket.emit('loginError', { msg: 'Server error during login' });
        }
    });

    socket.on('guestLogin', (data) => {
        let userId = data.userId;
        let name = data.name || 'Chef';

        console.log(`🎭 Guest login attempt - userId: ${userId}, name: ${name}`);

        if (!userId || !userId.startsWith('guest_')) {
            userId = 'guest_' + Math.random().toString(36).substr(2, 9);
            console.log(`🆕 Generated new guest ID: ${userId}`);
        }
        // Note: guests CAN have reconnect data (saved by userId = guest_xxx)

        // Check if guest is already logged in on another device
        if (userToSocket[userId] && userToSocket[userId] !== socket.id) {
            const existingSocket = io.sockets.sockets.get(userToSocket[userId]);
            if (existingSocket) {
                // Force disconnect the other session
                existingSocket.emit('forceLogout', {
                    msg: 'Your guest session has been opened on another device.'
                });
                existingSocket.disconnect(true);
                console.log(`🔒 Force logged out guest ${name} from previous device`);
            }
        }

        // Guests are kept in memory but not saved to disk
        if (!users[userId]) {
            console.log(`✨ Creating new guest user: ${userId}`);
            users[userId] = {
                id: userId,
                name: name,
                type: 'guest',
                createdAt: Date.now(),
                stats: {
                    gamesPlayed: 0,
                    scoreTotal: 0,
                    dishesServed: 0,
                    perfectDishes: 0,
                    itemsChopped: 0,
                    itemsCooked: 0,
                    burntFood: 0,
                    failedOrders: 0,
                    chefHatPoints: 0,
                    gameScores: [],
                    achievements: []
                }
            };
        } else {
            console.log(`♻️ Reusing existing guest user: ${userId}`);
            users[userId].name = name;
        }

        socketToUser[socket.id] = userId; // Track socket to user mapping
        userToSocket[userId] = socket.id; // Track user to socket mapping
        socket.emit('loginSuccess', users[userId]);
        // Send personalized room list immediately so reconnect button shows up
        socket.emit('roomList', buildRoomListPayload(userId));
        broadcastStatusUpdate(userId);
        console.log(`💟 Guest: ${name} (${userId})`);
    });

    socket.on('updateProfile', async (data) => {
        try {
            const userId = socketToUser[socket.id];
            if (!userId || !users[userId]) {
                return socket.emit('updateProfileError', { msg: 'Session error. Please logout and login again.' });
            }

            const user = users[userId];
            if (user.type !== 'account') {
                return socket.emit('updateProfileError', { msg: 'Only registered accounts can customize profile!' });
            }

            const { newUsername, newProfileImage, newProfileColor, newTitle, newBio } = data;
            console.log(`📡 Update Profile Request from ${userId}:`, { newUsername, newProfileImage });

            // 1. Check Name Uniqueness if changed
            if (newUsername && newUsername !== user.name) {
                const newId = 'user_' + newUsername.toLowerCase();

                // Check if ID is taken by someone ELSE
                if (users[newId] && newId !== userId) {
                    console.log(`⚠️ Profile Update Denied: ID conflict for ${newId}`);
                    return socket.emit('updateProfileError', { msg: 'This username is already taken!' });
                }

                // Check if any other user has this display name (case insensitive)
                const nameExists = Object.values(users).some(u =>
                    u && u.id !== userId && u.name && u.name.toLowerCase() === newUsername.toLowerCase()
                );
                if (nameExists) {
                    console.log(`⚠️ Profile Update Denied: Name conflict for ${newUsername}`);
                    return socket.emit('updateProfileError', { msg: 'This display name is already taken!' });
                }

                user.name = newUsername;
                user.username = newUsername; // Sync for consistency
            }

            if (newProfileImage) {
                user.profileImage = newProfileImage;
            }

            if (newProfileColor && /^#[0-9A-F]{6}$/i.test(newProfileColor)) {
                user.profileColor = newProfileColor;
            }

            if (newTitle !== undefined) {
                user.title = (newTitle || '').slice(0, 50); // Max 50 characters
            }

            if (newBio !== undefined) {
                user.bio = (newBio || '').slice(0, 200); // Max 200 characters
            }

            await persistUser(userId);

            const clone = { ...user };
            delete clone.password;
            socket.emit('updateProfileSuccess', { msg: 'Profile updated!', user: clone });

            // Also update the user in the room if they are in one
            const player = findPlayer(socket.id);
            if (player) {
                player.name = user.name;
                player.profileImage = user.profileImage;
                player.profileColor = user.profileColor;
                player.title = user.title;
                player.bio = user.bio;
                io.to(player.roomId).emit('playerProfileUpdated', {
                    id: socket.id,
                    name: player.name,
                    profileImage: player.profileImage,
                    profileColor: player.profileColor,
                    title: player.title,
                    bio: player.bio
                });
            }

            console.log(`✅ Profile Updated for ${userId}: Name=${user.name}, Image=${user.profileImage}`);
        } catch (error) {
            console.error('❌ Update Profile Error:', error);
            socket.emit('updateProfileError', { msg: 'Server error while saving profile.' });
        }
    });

    // ── RECONNECT (dedicated event) ───────────────────────────────────────────
    socket.on('reconnectRoom', (data) => {
        const roomId = data.roomId;
        const userId = socketToUser[socket.id];

        // No userId means not logged in yet — can't reconnect
        if (!userId) {
            socket.emit('reconnectFailed', { message: 'Not authenticated. Please log in again.' });
            return;
        }

        const savedData = disconnectedPlayers[userId];
        if (!savedData || savedData.roomId !== roomId) {
            // No saved data, or room mismatch — clear and tell client to do a normal join
            if (savedData) delete disconnectedPlayers[userId];
            socket.emit('reconnectFailed', { message: 'Session expired. Joining as new player.', fallbackJoin: true, roomId });
            return;
        }

        const room = rooms[roomId];
        if (!room) {
            delete disconnectedPlayers[userId];
            socket.emit('reconnectFailed', { message: 'Room no longer exists.' });
            return;
        }

        // Game-over / finished: can't reconnect, send them back to lobby
        if (room.state === 'gameover' || room.state === 'finished') {
            delete disconnectedPlayers[userId];
            socket.emit('reconnectFailed', { message: 'The game already ended.' });
            return;
        }

        // New session started (different gameSessionId): treat as new player
        const sessionChanged = savedData.gameSessionId &&
            room.gameSessionId &&
            savedData.gameSessionId !== room.gameSessionId;
        if (sessionChanged) {
            delete disconnectedPlayers[userId];
            // Don't hard-fail — tell client to join normally as a new player
            socket.emit('reconnectFailed', { message: 'A new game started. Joining as new player.', fallbackJoin: true, roomId });
            return;
        }

        console.log(`🔄 Reconnecting: ${data.name} → room ${roomId} (state: ${room.state})`);

        // Remove the stale (old-socket) entry from the room if it's still there
        const oldSocketId = savedData.playerData.id;
        if (oldSocketId && room.players[oldSocketId]) {
            console.log(`🧹 Removing old socket slot: ${oldSocketId}`);
            delete room.players[oldSocketId];
            io.to(roomId).emit('playerLeft', oldSocketId);
        }

        // Restore player with new socket ID
        const restoredPlayer = { ...savedData.playerData, id: socket.id };
        if (room.state === 'lobby') restoredPlayer.isReady = false;

        // ── AVOID SPAWNING ON TOP OF OTHERS ──
        const safeSpawn = findSafeSpawn(room, restoredPlayer.gridX, restoredPlayer.gridZ);
        if (safeSpawn.x !== restoredPlayer.gridX || safeSpawn.z !== restoredPlayer.gridZ) {
            console.log(`🔀 Adjusting spawn for reconnected player ${restoredPlayer.name} to avoid collision: (${restoredPlayer.gridX}, ${restoredPlayer.gridZ}) -> (${safeSpawn.x}, ${safeSpawn.z})`);
            restoredPlayer.gridX = safeSpawn.x;
            restoredPlayer.gridZ = safeSpawn.z;
            restoredPlayer.posX = safeSpawn.x * TILE_SIZE;
            restoredPlayer.posZ = safeSpawn.z * TILE_SIZE;
            restoredPlayer.targetX = restoredPlayer.posX;
            restoredPlayer.targetZ = restoredPlayer.posZ;
        }

        room.players[socket.id] = restoredPlayer;
        socket.join(roomId);

        // Consume the reconnect slot immediately after joining
        delete disconnectedPlayers[userId];

        // ── Send the full world state to the reconnecting player ──
        socket.emit('init', {
            playerId: socket.id,
            isHost: restoredPlayer.isHost,
            isReconnect: true,
            roomCode: room.roomCode,
            room: {
                id: room.id,
                players: room.players,
                kitchen: room.kitchen,
                stations: room.stations,
                orders: room.orders,
                score: room.score,
                timeLeft: room.timeLeft,
                state: room.state,
                mode: room.mode,
                difficulty: room.difficulty,
                droppedItems: room.droppedItems || {},
                activeRecipes: room.activeRecipes,
                activeIngredients: room.activeIngredients
            },
            config: {
                TILE_SIZE: room.config.TILE_SIZE,
                GRID_W: room.config.GRID_W,
                GRID_H: room.config.GRID_H,
                INGREDIENTS: room.activeIngredients,
                RECIPES: room.activeRecipes
            }
        });

        // ── Notify everyone else the player is back ──
        socket.to(roomId).emit('playerReconnected', restoredPlayer);

        // Sync full station / order / player state to entire room so all POVs match
        io.to(roomId).emit('gameStateUpdate', {
            stations: room.stations,
            orders: room.orders,
            score: room.score,
            players: room.players
        });

        socket.emit('reconnectSuccess', {
            message: 'Successfully rejoined!',
            roomState: room.state
        });

        console.log(`✅ ${restoredPlayer.name} reconnected to ${roomId} (${room.state})`);
        broadcastRoomList();
        if (userId) broadcastStatusUpdate(userId);
    });

    socket.on('joinRoom', (data) => {
        const roomId = data.roomId || 'kitchen_1';
        const userId = socketToUser[socket.id];

        // ── If this user has pending reconnect data for THIS room, redirect to reconnectRoom flow ──
        if (userId && disconnectedPlayers[userId] && disconnectedPlayers[userId].roomId === roomId) {
            // Delegate to the dedicated reconnect handler instead of going through normal join
            socket.emit('useReconnect', { roomId }); // tell client to use reconnectRoom event
            return;
        }

        // Normal join flow
        // Check if room exists and has password
        const existingRoom = rooms[roomId];
        if (existingRoom && existingRoom.hasPassword && !data.password) {
            socket.emit('passwordRequired', { roomId: roomId });
            return;
        }

        // Check password if provided
        if (existingRoom && existingRoom.hasPassword && data.password) {
            if (existingRoom.password !== data.password) {
                socket.emit('notification', { msg: 'Incorrect password!', type: 'error' });
                return;
            }
        }

        const settings = {
            mode: data.mode || 'single',
            difficulty: data.difficulty || 'easy'
        };

        const room = getOrCreateRoom(roomId, settings);

        if (room.mode === 'single' && Object.keys(room.players).length >= 1) {
            socket.emit('notification', { msg: 'Single player room full!', type: 'error' });
            return;
        }
        if (room.mode === 'multi_coop' && Object.keys(room.players).length >= 3) {
            socket.emit('notification', { msg: 'Room full (Max 3)!', type: 'error' });
            return;
        }
        if (room.mode === 'multi_vs' && Object.keys(room.players).length >= 2) {
            socket.emit('notification', { msg: 'Room full (Max 2)!', type: 'error' });
            return;
        }

        socket.join(roomId);

        // Calculate player index (0, 1, 2)
        // Use next available index or simple count
        const existingIds = Object.keys(room.players);
        const colorIdx = existingIds.length % PLAYER_COLORS.length;

        // Spawns - dynamic based on map layout or custom spawns
        const gw = room.config.GRID_W;
        const gh = room.config.GRID_H;
        let spawn = { x: 1, z: 1 }; // fallback

        // 1. Check for custom spawns (P1, P2, P3)
        // colorIdx is 0 for P1, 1 for P2, etc.
        const spawnKey = colorIdx + 1;
        if (room.spawns && room.spawns[spawnKey]) {
            const requestedSpawn = room.spawns[spawnKey];
            spawn = findSafeSpawn(room, requestedSpawn.x, requestedSpawn.z);
            console.log(`📍 Using safe custom spawn P${spawnKey} for ${socket.id} at (${spawn.x}, ${spawn.z})`);
        } else {
            // 2. Fallback to spiral search if no custom spawn
            // Start searching from center
            const center = { x: Math.floor(gw / 2), z: Math.floor(gh / 2) };
            spawn = findSafeSpawn(room, center.x, center.z);
        }

        // const playerColors = ... (already defined)
        // const playerEmojis = ... (already defined)
        // const colorIdx = ... (already calculated above)

        // Determine if this player is the host (first player in room)
        const existingPlayerIds = Object.keys(room.players);
        const isHost = existingPlayerIds.length === 0;

        const player = {
            id: socket.id,
            userId: userId,
            userType: users[userId] ? users[userId].type : 'guest',
            username: users[userId] ? users[userId].username : null,
            name: data.name || `Chef_${socket.id.slice(0, 4)}`,
            roomId: roomId,
            gridX: spawn.x,
            gridZ: spawn.z,
            posX: spawn.x * TILE_SIZE,
            posZ: spawn.z * TILE_SIZE,
            targetX: spawn.x * TILE_SIZE,
            targetZ: spawn.z * TILE_SIZE,
            facing: 'down', // up, down, left, right
            holding: null,  // { type: 'ingredient'|'plate', data: {...} }
            color: PLAYER_COLORS[colorIdx],
            emoji: PLAYER_EMOJIS[colorIdx],
            profileImage: users[userId] ? users[userId].profileImage : 'chef_1',
            profileColor: users[userId] ? users[userId].profileColor : '#FF6B6B',
            title: users[userId] ? users[userId].title : '',
            bio: users[userId] ? users[userId].bio : '',
            isChopping: false,
            chopStationId: null,
            score: 0,
            dishesServed: 0,
            perfectDishes: 0,
            itemsChopped: 0,
            itemsCooked: 0,
            burntFood: 0,
            isHost: isHost,
            isReady: false, // Ready status for non-host players
        };

        room.players[socket.id] = player;

        // Tell the joining player about the full state
        socket.emit('init', {
            playerId: socket.id,
            isHost: isHost,
            roomCode: room.roomCode,
            room: {
                id: room.id,
                players: room.players,
                kitchen: room.kitchen,
                stations: room.stations,
                orders: room.orders,
                score: room.score,
                timeLeft: room.timeLeft,
                state: room.state,
                mode: room.mode,
                difficulty: room.difficulty,
                droppedItems: room.droppedItems || {}
            },
            config: {
                TILE_SIZE: room.config.TILE_SIZE,
                GRID_W: room.config.GRID_W,
                GRID_H: room.config.GRID_H,
                // Send only active sets to avoid client confusion
                INGREDIENTS: room.activeIngredients,
                RECIPES: room.activeRecipes,
            }
        });

        // Tell others about new player
        socket.to(roomId).emit('playerJoined', player);

        console.log(`👨‍🍳 ${player.name} joined room ${roomId} (${Object.keys(room.players).length} players)`);

        broadcastRoomList(); // Update player counts on server list

        // Auto-start single player games immediately (skip waiting room)
        if (room.mode === 'single' && room.state === 'lobby') {
            startGame(room);
        }

        // Broadcast status update for the joining player
        if (userId) broadcastStatusUpdate(userId);
    });

    // Player movement
    // Player movement
    socket.on('move', (data) => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room || room.state !== 'playing') return;

        // Float coordinates
        const x = data.x;
        const z = data.z;

        // Basic map bounds check
        const limitX = room.config.GRID_W * TILE_SIZE;
        const limitZ = room.config.GRID_H * TILE_SIZE;
        if (x < 0 || x > limitX || z < 0 || z > limitZ) return;

        // Update player info
        player.posX = x;
        player.posZ = z;
        // Keep grid coordinates updated for interaction logic (finding nearest station)
        player.gridX = Math.round(x / TILE_SIZE);
        player.gridZ = Math.round(z / TILE_SIZE);
        player.facing = data.facing || player.facing;

        socket.to(player.roomId).emit('playerMoved', {
            id: socket.id,
            x: x,
            z: z,
            facing: player.facing,
            holding: player.holding,
        });
    });

    // Interact with station (pickup/place/use)
    socket.on('interact', (data) => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room || room.state !== 'playing') return;

        const stationId = data.stationId;
        const station = room.stations[stationId];
        if (!station) return;

        // Distance-based interaction check (more forgiving)
        // Station center in world coords
        const sx = station.gridX * TILE_SIZE;
        const sz = station.gridZ * TILE_SIZE;

        // Player center (approx)
        const px = player.posX !== undefined ? player.posX : player.gridX * TILE_SIZE;
        const pz = player.posZ !== undefined ? player.posZ : player.gridZ * TILE_SIZE;

        const dist = Math.sqrt(Math.pow(sx - px, 2) + Math.pow(sz - pz, 2));

        // Allow if within ~1.5 tiles distance (diagonal adjacency is ~1.41)
        if (dist > TILE_SIZE * 1.8) return;

        handleInteraction(player, station, room);
    });

    // Throw held item onto the floor (physics)
    socket.on('throwItem', (data) => {
        const player = findPlayer(socket.id);
        if (!player || !player.holding) return;
        const room = rooms[player.roomId];
        if (!room || room.state !== 'playing') return;

        // Calculate vx, vz based on facing direction
        let vx = 0; let vz = 0;
        // REDUCED THROW POWER
        const speed = 0.25 * (data.power || 1.0); // reduced from 0.5
        if (player.facing === 'up') vz = -speed;
        if (player.facing === 'down') vz = speed;
        if (player.facing === 'left') vx = -speed;
        if (player.facing === 'right') vx = speed;

        const itemId = 'item_' + Date.now() + Math.random().toString(36).substr(2, 5);

        let startX = player.posX !== undefined ? player.posX : player.gridX * TILE_SIZE;
        let startZ = player.posZ !== undefined ? player.posZ : player.gridZ * TILE_SIZE;

        if (!room.droppedItems) room.droppedItems = {};

        room.droppedItems[itemId] = {
            id: itemId,
            data: player.holding,
            x: startX,
            z: startZ,
            y: 1.5, // Start slightly up from chef's hands
            vx: vx * 1.5,
            vz: vz * 1.5,
            vy: 0.5 * (data.power || 1.0), // reduced from 0.8

        };
        player.holding = null;
        io.to(room.id).emit('itemThrown', { itemId, item: room.droppedItems[itemId] });
        emitPlayerUpdate(player, room);
        console.log(`💨 ${player.name} threw an item! ID: ${itemId}`);
    });

    // Pick up a dropped item from the floor
    socket.on('pickupItem', (data) => {
        const player = findPlayer(socket.id);
        if (!player || player.holding) return;
        const room = rooms[player.roomId];
        if (!room || room.state !== 'playing') return;

        const itemId = data.itemId;
        if (room.droppedItems && room.droppedItems[itemId]) {
            player.holding = room.droppedItems[itemId].data;
            delete room.droppedItems[itemId];
            io.to(room.id).emit('itemPickedUp', { itemId, playerId: socket.id });
            emitPlayerUpdate(player, room);
            console.log(`🖐️ ${player.name} picked up item! ID: ${itemId}`);
        }
    });

    // Chop action (hold spacebar)
    socket.on('chopAction', (data) => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room || room.state !== 'playing') return;

        const station = room.stations[data.stationId];
        if (!station || station.type !== 'chopping') return;

        // --- AUTO-PLACE LOGIC ---
        // If station is empty and player is holding a choppable ingredient, place it first
        if (!station.contents && player.holding && player.holding.type === 'ingredient') {
            const ingConfig = room.activeIngredients[player.holding.name];
            if (ingConfig && ingConfig.chopTime > 0 && !player.holding.chopped) {
                station.contents = player.holding;
                // PRESERVE PROGRESS: Only reset if ingredient doesn't have existing progress
                if (typeof player.holding.chopProgress !== 'number') {
                    station.chopProgress = 0;
                    player.holding.chopProgress = 0;
                } else {
                    station.chopProgress = player.holding.chopProgress;
                }
                player.holding = null;
                emitPlayerUpdate(player, room);
                console.log(`🧼 Auto-placed ${station.contents.name} for chopping (progress: ${station.chopProgress}%)`);
            }
        }

        if (!station.contents || station.contents.type !== 'ingredient') return;

        // Skip if already chopped or doesn't need chopping
        const ingredient = room.activeIngredients[station.contents.name];
        if (!ingredient || ingredient.chopTime === 0 || station.contents.chopped) return;

        // Throttling: Check last chop time
        const now = Date.now();
        if (player.lastChopTime && now - player.lastChopTime < 50) return;
        player.lastChopTime = now;

        // Increment chop progress
        const baseSpeed = ingredient.chopTime || 1000;
        const increment = 10000 / baseSpeed; // 10000 ensures chopTime is literal ms (3s = 3000ms)
        station.chopProgress += increment;

        // SAVE PROGRESS: Update ingredient's progress too
        if (station.contents) {
            station.contents.chopProgress = station.chopProgress;
        }

        // Check completion (inclusive of slight rounding)
        if (station.chopProgress >= 98.0) {
            station.contents.chopped = true;
            station.chopProgress = 100;
            if (station.contents) {
                station.contents.chopProgress = 100;
            }

            // Increment player chop stat
            player.itemsChopped = (player.itemsChopped || 0) + 1;

            io.to(room.id).emit('chopComplete', {
                stationId: station.id,
                ingredient: station.contents.name,
                playerId: socket.id,
                totalChopped: player.itemsChopped,
            });
        }

        io.to(room.id).emit('stationUpdate', {
            stationId: station.id,
            station: sanitizeStation(station),
        });
    });

    // Roll action (hold spacebar at roller)
    socket.on('rollAction', (data) => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room || room.state !== 'playing') return;

        const station = room.stations[data.stationId];
        if (!station || station.type !== 'roller') return;

        // Auto-place logic for Dough
        if (!station.contents && player.holding && player.holding.name === 'dough' && !player.holding.rolled) {
            station.contents = player.holding;
            // PRESERVE PROGRESS: Only reset if dough doesn't have existing progress
            if (typeof player.holding.rollProgress !== 'number') {
                station.rollProgress = 0;
                player.holding.rollProgress = 0;
            } else {
                station.rollProgress = player.holding.rollProgress;
            }
            player.holding = null;
            emitPlayerUpdate(player, room);
        }

        if (!station.contents || station.contents.name !== 'dough' || station.contents.rolled) return;

        const ingConfig = room.activeIngredients['dough'];
        const rollTime = ingConfig.rollTime || 3000;

        station.rollProgress += (10000 / rollTime);

        // SAVE PROGRESS: Update dough's progress too
        if (station.contents) {
            station.contents.rollProgress = station.rollProgress;
        }

        if (station.rollProgress >= 98) {
            station.contents.rolled = true;
            station.rollProgress = 100;
            if (station.contents) {
                station.contents.rollProgress = 100;
            }
            io.to(room.id).emit('notification', { msg: 'Dough Rolled!', type: 'success' });
        }

        io.to(room.id).emit('stationUpdate', {
            stationId: station.id,
            station: sanitizeStation(station),
        });
    });

    // Wash action (hold spacebar at sink)
    socket.on('washAction', (data) => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room || room.state !== 'playing') return;

        const station = room.stations[data.stationId];
        if (!station || station.type !== 'sink') return;

        // Auto-place rice if holding it
        if (!station.contents && player.holding && player.holding.name === 'rice' && !player.holding.washed) {
            station.contents = player.holding;
            // PRESERVE PROGRESS: Only reset if rice doesn't have existing progress
            if (typeof player.holding.washProgress !== 'number') {
                station.washProgress = 0;
                player.holding.washProgress = 0;
            } else {
                station.washProgress = player.holding.washProgress;
            }
            player.holding = null;
            emitPlayerUpdate(player, room);
        }

        if (!station.contents || station.contents.name !== 'rice' || station.contents.washed) return;

        const ingConfig = room.activeIngredients['rice'];
        const washTime = ingConfig.washTime || 2000;

        station.washProgress = (station.washProgress || 0) + (10000 / washTime);

        // SAVE PROGRESS: Update rice's progress too
        if (station.contents) {
            station.contents.washProgress = station.washProgress;
        }

        if (station.washProgress >= 98) {
            station.contents.washed = true;
            station.washProgress = 100;
            if (station.contents) {
                station.contents.washProgress = 100;
            }
            io.to(room.id).emit('notification', { msg: '✅ Rice washed! Now cook it!', type: 'success' });
        }

        io.to(room.id).emit('stationUpdate', {
            stationId: station.id,
            station: sanitizeStation(station),
        });
    });

    // Garnish action (hold spacebar at a seasoning station while rareSeasoning is active)
    socket.on('garnishAction', (data) => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room || room.state !== 'playing') return;

        const station = room.stations[data.stationId];
        // Must be a seasoning station with an ACTIVE rare spawn
        if (!station || station.type !== 'seasoning' || !station.rareSeasoning) return;

        // Target must be a plate on the station
        if (!station.contents || station.contents.type !== 'plate') return;
        if (station.contents.seasoning) return; // Already garnished

        // Only garnish fully assembled food
        const isAssembled = Object.values(RECIPES).some(recipe =>
            checkPlateMatchesOrder(station.contents, recipe)
        );

        if (!isAssembled) {
            if (Date.now() % 20 === 0) {
                socket.emit('notification', { msg: "⚠️ Dish is not fully assembled!", type: 'error' });
            }
            return;
        }

        // Garnish progress (Faster now because it only lasts 5s)
        if (typeof station.garnishProgress !== 'number') station.garnishProgress = 0;
        station.garnishProgress += 10; // 2x faster than before

        if (station.garnishProgress >= 100) {
            station.contents.seasoning = station.rareSeasoning; // Use station's active seasoning
            station.garnishProgress = 0;
            // Rare seasoning is spent
            station.rareSeasoning = null;
            station.rareSeasoningExpires = null;

            io.to(room.id).emit('notification', {
                msg: `✨ DISH GARNISHED WITH ${station.contents.seasoning.toUpperCase()}! (+8 pts)`,
                type: 'success'
            });
        }

        io.to(room.id).emit('stationUpdate', {
            stationId: station.id,
            station: sanitizeStation(station),
        });
    });

    // Start game (only host can start)
    socket.on('startGame', () => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room || room.state !== 'lobby') return;

        // Check if player is host
        if (!player.isHost) {
            socket.emit('notification', { msg: 'Only the host can start the game!', type: 'error' });
            return;
        }

        // For multiplayer, check if all non-host players are ready (optional requirement)
        if (room.mode !== 'single') {
            const nonHostPlayers = Object.values(room.players).filter(p => !p.isHost);
            if (nonHostPlayers.length > 0) {
                const allReady = nonHostPlayers.every(p => p.isReady);
                if (!allReady) {
                    socket.emit('notification', { msg: 'Wait for all players to be ready!', type: 'warning' });
                    return;
                }
            }
        }

        startGame(room);
    });

    // Restart game
    socket.on('restartGame', () => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room) return;

        restartGame(room);
    });

    // Pause game (single player only)
    socket.on('pauseGame', () => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room || room.mode !== 'single' || room.state !== 'playing') return;

        if (!room.isPaused) {
            room.isPaused = true;
            room.pausedAt = Date.now();

            console.log(`⏸️  Game paused in room ${room.id}`);
            socket.emit('gamePaused', { isPaused: true });
        }
    });

    // Resume game (single player only)
    socket.on('resumeGame', () => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room || room.mode !== 'single' || room.state !== 'playing') return;

        if (room.isPaused) {
            // Adjust gameStartAt to account for paused time
            const pausedDuration = Date.now() - room.pausedAt;
            room.gameStartAt += pausedDuration;
            room.isPaused = false;
            room.pausedAt = null;

            console.log(`▶️  Game resumed in room ${room.id}, adjusted time by ${pausedDuration}ms`);
            socket.emit('gameResumed', { isPaused: false });
        }
    });

    // Chat
    socket.on('chatMessage', (msg) => {
        const player = findPlayer(socket.id);
        if (!player) return;
        io.to(player.roomId).emit('chatMessage', {
            id: socket.id,
            sender: player.name,
            message: msg,
            color: player.color,
            timestamp: Date.now(),
        });
    });

    // Set name
    socket.on('setName', (name) => {
        const player = findPlayer(socket.id);
        if (player) {
            player.name = name.slice(0, 15);
            io.to(player.roomId).emit('playerRenamed', {
                id: socket.id,
                name: player.name,
            });
        }
    });

    // Leave Room (Explicit)
    socket.on('leaveRoom', () => {
        const player = findPlayer(socket.id);
        if (player) {
            const room = rooms[player.roomId];
            if (room) {
                const wasHost = player.isHost;
                const userId = socketToUser[socket.id];

                // Save state so they can reconnect even if they explicitly left
                const gameCanContinue = room.state !== 'gameover' && room.state !== 'finished';
                if (gameCanContinue && userId) {
                    disconnectedPlayers[userId] = {
                        roomId: room.id,
                        gameSessionId: room.gameSessionId,
                        playerData: { ...player },
                        disconnectTime: Date.now()
                    };
                    console.log(`💾 Saved reconnect state for ${player.name} (${userId}) after explicit leave`);
                }

                // Remove from active players
                delete room.players[socket.id];
                if (wasHost && Object.keys(room.players).length > 0) {
                    const remainingPlayerIds = Object.keys(room.players).sort();
                    const newHostId = remainingPlayerIds[0];
                    room.players[newHostId].isHost = true;
                    room.players[newHostId].isReady = false;
                    io.to(room.id).emit('hostChanged', { newHostId: newHostId });
                    console.log(`👑 New host assigned: ${room.players[newHostId].name}`);
                }

                io.to(room.id).emit('playerLeft', socket.id);
                console.log(`👋 Player ${player.name} left room ${room.id}`);

                // Clean up empty rooms immediately — NO ghost 0-player rooms allowed
                if (Object.keys(room.players).length === 0) {
                    clearTimers(room);
                    delete rooms[room.id];
                    console.log(`🗑️ Room ${room.id} deleted (empty)`);

                    // Wipe any reconnect data for this dead room
                    Object.keys(disconnectedPlayers).forEach(uid => {
                        if (disconnectedPlayers[uid].roomId === room.id) {
                            delete disconnectedPlayers[uid];
                        }
                    });
                }

                broadcastRoomList();
                if (userId) broadcastStatusUpdate(userId);
            }
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        const player = findPlayer(socket.id);
        const userId = socketToUser[socket.id];

        console.log('Player disconnecting:', socket.id, 'userId:', userId);

        if (player) {
            const room = rooms[player.roomId];
            if (room) {
                console.log('Room state:', room.state, 'Room ID:', room.id);

                // Decide whether this player can reconnect
                const gameCanContinue = room.state !== 'gameover' && room.state !== 'finished';

                // Always remove their active player slot so others don't see a ghost
                const wasHost = room.players[socket.id]?.isHost || false;
                delete room.players[socket.id];

                if (gameCanContinue && userId) {
                    // ── Save state so they can reconnect ──
                    disconnectedPlayers[userId] = {
                        roomId: room.id,
                        gameSessionId: room.gameSessionId,
                        playerData: { ...player },
                        disconnectTime: Date.now()
                    };
                    console.log(`💾 Saved reconnect state for ${player.name} (${userId}) – session ${room.gameSessionId}`);

                    // Tell others: player disconnected but can come back
                    io.to(room.id).emit('playerDisconnected', {
                        id: socket.id,
                        name: player.name,
                        canReconnect: true
                    });
                } else {
                    // Game over or guest — just remove cleanly
                    io.to(room.id).emit('playerLeft', socket.id);
                }

                // Assign new host if the host dropped
                if (wasHost && Object.keys(room.players).length > 0) {
                    const newHostId = Object.keys(room.players).sort()[0];
                    room.players[newHostId].isHost = true;
                    room.players[newHostId].isReady = false;
                    io.to(room.id).emit('hostChanged', { newHostId });
                    console.log(`👑 New host after disconnect: ${room.players[newHostId].name}`);
                }

                // Keep room alive only when there are pending reconnects
                if (Object.keys(room.players).length === 0) {
                    const hasPending = Object.values(disconnectedPlayers).some(dp => dp.roomId === room.id);
                    if (!hasPending) {
                        clearTimers(room);
                        delete rooms[room.id];
                        console.log(`🗑️ Room ${room.id} deleted (empty, no pending reconnects)`);
                    } else {
                        console.log(`⏳ Room ${room.id} kept alive for reconnection (HIDDEN from others)`);
                    }
                }
            }
        }

        // Clean up socket → user mapping
        if (userId && userToSocket[userId] === socket.id) {
            delete userToSocket[userId];
            console.log(`🔓 Cleared session for user: ${userId}`);
        }
        delete socketToUser[socket.id];
        if (userId) {
            delete userToSocket[userId];
            broadcastStatusUpdate(userId);
            console.log(`[Status] Broadcasted offline for ${userId}`);
        }

        console.log(`❌ Chef disconnected: ${socket.id}`);
        broadcastRoomList();
    });

    // Toggle Ready Status (non-host players only)
    socket.on('toggleReady', () => {
        const player = findPlayer(socket.id);
        if (!player) return;
        const room = rooms[player.roomId];
        if (!room) return;

        // Host doesn't need to be ready
        if (player.isHost) {
            socket.emit('notification', { msg: 'Host doesn\'t need to be ready!', type: 'info' });
            return;
        }

        player.isReady = !player.isReady;
        // Broadcast to everyone in room to update UI
        io.to(room.id).emit('playerReadyUpdate', { id: socket.id, isReady: player.isReady });

        console.log(`✅ Player ${player.name} is ${player.isReady ? 'ready' : 'not ready'}`);
    });

    socket.on('getUserProfile', () => {
        const userId = socketToUser[socket.id];
        if (!userId || !users[userId]) {
            socket.emit('userProfile', null);
            return;
        }

        const user = users[userId];
        const stats = user.stats;

        // Calculate additional computed stats
        const totalAchievements = stats.achievements.length;
        const averageScore = stats.gamesPlayed > 0 ? Math.round(stats.scoreTotal / stats.gamesPlayed) : 0;
        const averageDishes = stats.gamesPlayed > 0 ? Math.round(stats.dishesServed / stats.gamesPlayed) : 0;

        // Group achievements by type
        const achievementGroups = {
            score: stats.achievements.filter(a => a.id.includes('score_')).length,
            dishes: stats.achievements.filter(a => a.id.includes('dishes_')).length,
            special: stats.achievements.filter(a => !a.id.includes('score_') && !a.id.includes('dishes_') && !a.id.includes('games_')).length,
            veteran: stats.achievements.filter(a => a.id.includes('games_')).length
        };

        // Recent games (last 10)
        const recentGames = stats.gameScores.slice(-10).reverse();

        const profile = {
            id: user.id,
            username: user.username,
            name: user.name,
            type: user.type,
            profileImage: user.profileImage,
            profileColor: user.profileColor,
            title: user.title,
            bio: user.bio,
            createdAt: user.createdAt,
            stats: {
                ...stats,
                // Computed fields
                averageScore,
                averageDishes,
                totalAchievements,
                achievementGroups,
                recentGames
            },
            friends: user.friends || []
        };

        socket.emit('userProfile', profile);
    });

    socket.on('getPlayerProfile', (data) => {
        const { playerId } = data;
        const requestingUserId = socketToUser[socket.id];

        if (!requestingUserId || !users[requestingUserId]) {
            socket.emit('playerProfile', null);
            return;
        }

        if (!playerId || !users[playerId]) {
            socket.emit('playerProfile', null);
            return;
        }

        const user = users[playerId];
        const stats = user.stats;

        // Calculate additional computed stats
        const totalAchievements = stats.achievements.length;
        const averageScore = stats.gamesPlayed > 0 ? Math.round(stats.scoreTotal / stats.gamesPlayed) : 0;
        const averageDishes = stats.gamesPlayed > 0 ? Math.round(stats.dishesServed / stats.gamesPlayed) : 0;

        // Group achievements by type
        const achievementGroups = {
            score: stats.achievements.filter(a => a.id.includes('score_')).length,
            dishes: stats.achievements.filter(a => a.id.includes('dishes_')).length,
            special: stats.achievements.filter(a => !a.id.includes('score_') && !a.id.includes('dishes_') && !a.id.includes('games_')).length,
            veteran: stats.achievements.filter(a => a.id.includes('games_')).length
        };

        // Recent games (last 5 for public view)
        const recentGames = stats.gameScores.slice(-5).reverse();

        const profile = {
            id: user.id,
            username: user.username,
            name: user.name,
            type: user.type,
            profileImage: user.profileImage,
            profileColor: user.profileColor,
            title: user.title,
            bio: user.bio,
            createdAt: user.createdAt,
            stats: {
                gamesPlayed: stats.gamesPlayed,
                scoreTotal: stats.scoreTotal,
                dishesServed: stats.dishesServed,
                chefHatPoints: stats.chefHatPoints,
                achievements: stats.achievements, // Show achievements publicly
                // Computed fields
                averageScore,
                averageDishes,
                totalAchievements,
                achievementGroups,
                recentGames
            },
            friends: user.friends ? user.friends.length : 0, // Show friend count only
            isFriend: user.friends && user.friends.includes(requestingUserId)
        };

        socket.emit('playerProfile', profile);
    });

    socket.on('getLeaderboard', (data) => {
        const { type = 'score', limit = 10 } = data;

        // Get all registered users (accounts only)
        const allUsers = Object.values(users).filter(u => u.type === 'account');

        let leaderboard = [];

        if (type === 'score') {
            leaderboard = allUsers
                .map(user => ({
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    profileImage: user.profileImage,
                    profileColor: user.profileColor,
                    title: user.title,
                    value: user.stats.scoreTotal,
                    games: user.stats.gamesPlayed,
                    average: user.stats.gamesPlayed > 0 ? Math.round(user.stats.scoreTotal / user.stats.gamesPlayed) : 0
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, limit);
        } else if (type === 'dishes') {
            leaderboard = allUsers
                .map(user => ({
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    profileImage: user.profileImage,
                    profileColor: user.profileColor,
                    title: user.title,
                    value: user.stats.dishesServed,
                    games: user.stats.gamesPlayed,
                    average: user.stats.gamesPlayed > 0 ? Math.round(user.stats.dishesServed / user.stats.gamesPlayed) : 0
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, limit);
        } else if (type === 'achievements') {
            leaderboard = allUsers
                .map(user => ({
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    profileImage: user.profileImage,
                    profileColor: user.profileColor,
                    title: user.title,
                    value: user.stats.achievements.length,
                    games: user.stats.gamesPlayed
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, limit);
        } else if (type === 'chefHatPoints') {
            leaderboard = allUsers
                .map(user => ({
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    profileImage: user.profileImage,
                    profileColor: user.profileColor,
                    title: user.title,
                    value: user.stats.chefHatPoints,
                    games: user.stats.gamesPlayed
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, limit);
        }

        socket.emit('leaderboard', {
            type,
            limit,
            leaderboard,
            totalPlayers: allUsers.length
        });
    });

    // ============ NEW FEATURE HANDLERS ===========

    // Create Room (with password/description)
    socket.on('createRoom', (data) => {
        const userId = socketToUser[socket.id];
        const roomId = data.roomName || `room_${Date.now()}`;
        const settings = {
            mode: data.mode || 'multi_coop',
            difficulty: data.difficulty || 'easy',
            password: data.password
        };

        // Check if room already exists
        if (rooms[roomId] && Object.keys(rooms[roomId].players).length > 0) {
            socket.emit('notification', { msg: 'Room name already taken!', type: 'error' });
            return;
        }

        const room = getOrCreateRoom(roomId, settings);

        // Check player limits
        if (room.mode === 'single' && Object.keys(room.players).length >= 1) {
            socket.emit('notification', { msg: 'Single player room full!', type: 'error' });
            return;
        }
        if (room.mode === 'multi_coop' && Object.keys(room.players).length >= 3) {
            socket.emit('notification', { msg: 'Room full (Max 3)!', type: 'error' });
            return;
        }
        if (room.mode === 'multi_vs' && Object.keys(room.players).length >= 2) {
            socket.emit('notification', { msg: 'Room full (Max 2)!', type: 'error' });
            return;
        }

        socket.join(roomId);

        // Calculate player index
        const existingIds = Object.keys(room.players);
        const colorIdx = existingIds.length % PLAYER_COLORS.length;
        const isHost = existingIds.length === 0;

        // Spawn position
        const gw = room.config.GRID_W;
        const gh = room.config.GRID_H;
        let spawn = { x: 1, z: 1 };

        const spawnKey = colorIdx + 1;
        if (room.spawns && room.spawns[spawnKey]) {
            spawn = room.spawns[spawnKey];
        } else {
            const center = { x: Math.floor(gw / 2), z: Math.floor(gh / 2) };
            if (room.kitchen[center.z] && room.kitchen[center.z][center.x] === 0) {
                spawn = center;
            }
        }

        const player = {
            id: socket.id,
            userId: userId,
            userType: users[userId] ? users[userId].type : 'guest',
            username: users[userId] ? users[userId].username : null,
            name: data.name || `Chef_${socket.id.slice(0, 4)}`,
            roomId: roomId,
            gridX: spawn.x,
            gridZ: spawn.z,
            posX: spawn.x * TILE_SIZE,
            posZ: spawn.z * TILE_SIZE,
            targetX: spawn.x * TILE_SIZE,
            targetZ: spawn.z * TILE_SIZE,
            facing: 'down',
            holding: null,
            color: PLAYER_COLORS[colorIdx],
            emoji: PLAYER_EMOJIS[colorIdx],
            profileImage: users[userId] ? users[userId].profileImage : 'chef_1',
            profileColor: users[userId] ? users[userId].profileColor : '#FF6B6B',
            title: users[userId] ? users[userId].title : '',
            bio: users[userId] ? users[userId].bio : '',
            isChopping: false,
            chopStationId: null,
            score: 0,
            dishesServed: 0,
            isHost: isHost,
            isReady: false,
        };

        room.players[socket.id] = player;

        // Send init to the joining player
        socket.emit('init', {
            playerId: socket.id,
            isHost: isHost,
            roomCode: room.roomCode,
            room: {
                id: room.id,
                players: room.players,
                kitchen: room.kitchen,
                stations: room.stations,
                orders: room.orders,
                score: room.score,
                timeLeft: room.timeLeft,
                state: room.state,
                mode: room.mode,
                difficulty: room.difficulty,
                droppedItems: room.droppedItems || {},
            },
            config: {
                TILE_SIZE: room.config.TILE_SIZE,
                GRID_W: room.config.GRID_W,
                GRID_H: room.config.GRID_H,
                INGREDIENTS: room.activeIngredients,
                RECIPES: room.activeRecipes,
            }
        });

        // Tell others about new player
        socket.to(roomId).emit('playerJoined', player);

        console.log(`👨‍🍳 ${player.name} created and joined room ${roomId} (${Object.keys(room.players).length} players)`);

        broadcastRoomList();
        if (userId) broadcastStatusUpdate(userId);
    });

    // Join by Room Code
    socket.on('joinByCode', (data) => {
        const code = data.code;
        const roomId = roomCodeToId[code];

        if (!roomId) {
            socket.emit('joinByCodeResult', { success: false, message: 'Room not found!' });
            return;
        }

        const room = rooms[roomId];
        if (!room) {
            socket.emit('joinByCodeResult', { success: false, message: 'Room not found!' });
            return;
        }

        if (room.hasPassword) {
            socket.emit('joinByCodeResult', { success: true, requiresPassword: true, code: code, roomId: roomId });
        } else {
            socket.emit('joinByCodeResult', { success: true, requiresPassword: false, roomId: roomId });
        }
    });


    // Ping/Pong for connection quality
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // Friends System - Enhanced with proper user tracking
    socket.on('getFriends', () => {
        const userId = socketToUser[socket.id];
        if (!userId) {
            socket.emit('friendList', []);
            return;
        }

        const currentUser = users[userId];
        if (!currentUser || currentUser.type !== 'account') {
            socket.emit('friendList', []);
            return;
        }

        // Get user's friends from database
        if (currentUser.friends) {
            const friendsList = currentUser.friends.map(friendId => {
                const friendUser = users[friendId];
                if (!friendUser) return null;

                // Check detailed status
                const status = getUserStatus(friendId);

                return {
                    id: friendId,
                    name: friendUser.username || friendUser.name,
                    status: status
                };
            }).filter(f => f !== null);

            socket.emit('friendList', friendsList);
        } else {
            socket.emit('friendList', []);
        }

        // Also send pending friend requests
        if (currentUser.friendRequests) {
            socket.emit('friendRequests', currentUser.friendRequests || []);
        }
    });

    socket.on('addFriend', async (data) => {
        const currentUserId = socketToUser[socket.id];
        if (!currentUserId) {
            socket.emit('friendError', { message: 'You must be logged in to add friends!' });
            return;
        }

        const currentUser = users[currentUserId];

        if (!currentUser || currentUser.type !== 'account') {
            socket.emit('friendError', { message: 'Only registered accounts can add friends!' });
            return;
        }

        const input = data.name.trim();

        // Find the friend user by UID (numeric) or username
        const friendUserId = Object.keys(users).find(uid => {
            const u = users[uid];
            if (u.type !== 'account') return false;
            // Check numeric UID
            if (u.uid === input) return true;
            // Check username (case-insensitive)
            if (u.username && u.username.toLowerCase() === input.toLowerCase()) return true;
            return false;
        });

        if (!friendUserId) {
            socket.emit('friendError', { message: `User "${input}" not found!` });
            return;
        }

        const friendUser = users[friendUserId];

        if (friendUser.type !== 'account') {
            socket.emit('friendError', { message: 'Cannot add guest accounts as friends!' });
            return;
        }

        if (friendUserId === currentUserId) {
            socket.emit('friendError', { message: 'You cannot add yourself as a friend!' });
            return;
        }

        // Initialize friends arrays if they don't exist
        if (!currentUser.friends) currentUser.friends = [];
        if (!friendUser.friendRequests) friendUser.friendRequests = [];

        // Check if already friends
        if (currentUser.friends.includes(friendUserId)) {
            socket.emit('friendError', { message: `You are already friends with ${friendUser.username}!` });
            return;
        }

        // Check if request already sent
        if (friendUser.friendRequests.some(req => req.from === currentUserId)) {
            socket.emit('friendError', { message: 'Friend request already sent!' });
            return;
        }

        // Add friend request to target user
        friendUser.friendRequests.push({
            from: currentUserId,
            fromName: currentUser.username,
            timestamp: Date.now()
        });

        // Save to database
        await persistUser(friendUserId);

        socket.emit('friendAdded', {
            success: true,
            name: friendUser.username,
            message: `Friend request sent to ${friendUser.username}!`
        });

        // Notify the friend if they're online
        const friendSocketId = Object.keys(socketToUser).find(sid => socketToUser[sid] === friendUserId);

        if (friendSocketId) {
            const friendSocket = io.sockets.sockets.get(friendSocketId);
            if (friendSocket) {
                friendSocket.emit('friendRequestReceived', {
                    from: currentUserId,
                    fromName: currentUser.username,
                    message: `${currentUser.username} sent you a friend request!`
                });
            }
        }
    });

    socket.on('acceptFriendRequest', async (data) => {
        const currentUserId = socketToUser[socket.id];
        if (!currentUserId) return;

        const currentUser = users[currentUserId];
        const requesterId = data.from;
        const requester = users[requesterId];

        if (!currentUser || !requester) return;

        // Initialize friends arrays
        if (!currentUser.friends) currentUser.friends = [];
        if (!requester.friends) requester.friends = [];
        if (!currentUser.friendRequests) currentUser.friendRequests = [];

        // Remove the request
        currentUser.friendRequests = currentUser.friendRequests.filter(req => req.from !== requesterId);

        // Add to both friends lists
        if (!currentUser.friends.includes(requesterId)) {
            currentUser.friends.push(requesterId);
        }
        if (!requester.friends.includes(currentUserId)) {
            requester.friends.push(currentUserId);
        }

        // Save both users
        await persistUser(currentUserId);
        await persistUser(requesterId);

        socket.emit('friendRequestAccepted', {
            name: requester.username,
            message: `You are now friends with ${requester.username}!`
        });

        // Refresh friends list
        socket.emit('getFriends');

        // Notify the requester if online
        const requesterSocketId = Object.keys(socketToUser).find(sid => socketToUser[sid] === requesterId);

        if (requesterSocketId) {
            const requesterSocket = io.sockets.sockets.get(requesterSocketId);
            if (requesterSocket) {
                requesterSocket.emit('friendRequestAccepted', {
                    name: currentUser.username,
                    message: `${currentUser.username} accepted your friend request!`
                });
                requesterSocket.emit('getFriends');
            }
        }
    });

    socket.on('rejectFriendRequest', async (data) => {
        const currentUserId = socketToUser[socket.id];
        if (!currentUserId) return;

        const currentUser = users[currentUserId];

        if (!currentUser || !currentUser.friendRequests) return;

        // Remove the request
        currentUser.friendRequests = currentUser.friendRequests.filter(req => req.from !== data.from);
        await persistUser(currentUserId);

        socket.emit('friendRequestRejected', { message: 'Friend request rejected' });
    });


    socket.on('inviteFriendToRoom', (data) => {
        const currentUserId = socketToUser[socket.id];
        console.log('Invite request from userId:', currentUserId);

        if (!currentUserId) {
            console.log('No userId found for socket:', socket.id);
            return;
        }

        const currentUser = users[currentUserId];
        if (!currentUser) {
            console.log('No user found for userId:', currentUserId);
            return;
        }

        const friendId = data.friendId;
        const roomCode = data.roomCode;
        const roomName = data.roomName;

        console.log('Inviting friend:', friendId, 'to room:', roomName, 'code:', roomCode);

        // Find friend's socket
        const friendSocketId = userToSocket[friendId];
        console.log('Friend socket ID:', friendSocketId);

        if (friendSocketId) {
            // Check if friend is in a room and in-game
            const player = findPlayer(friendSocketId);
            if (player) {
                const room = rooms[player.roomId];
                if (room && room.state !== 'lobby') {
                    socket.emit('notification', { msg: 'This friend is currently in a game!', type: 'error' });
                    return;
                }
            }

            const friendSocket = io.sockets.sockets.get(friendSocketId);
            if (friendSocket) {
                const inviteData = {
                    from: currentUserId,
                    fromName: currentUser.username || currentUser.name,
                    roomCode: roomCode,
                    roomName: roomName
                };
                console.log('Sending invitation to friend:', inviteData);
                friendSocket.emit('roomInvitation', inviteData);
                console.log(`📨 ${currentUser.username} invited friend to room ${roomName}`);
            } else {
                console.log('Friend socket not found in io.sockets');
            }
        } else {
            console.log('Friend is not online (no socket found)');
        }
    });

    // Kick Player (host only)
    socket.on('kickPlayer', (data) => {
        const player = findPlayer(socket.id);
        if (!player || !player.isHost) {
            socket.emit('notification', { msg: 'Only the host can kick players!', type: 'error' });
            return;
        }

        const room = rooms[player.roomId];
        if (!room) return;

        const targetPlayer = room.players[data.playerId];
        if (!targetPlayer) return;

        // Kick the player
        const kickedSocket = io.sockets.sockets.get(data.playerId);
        if (kickedSocket) {
            kickedSocket.emit('playerKicked', { message: `You were kicked from ${room.id}` });
            kickedSocket.leave(room.id);
            delete room.players[data.playerId];
            io.to(room.id).emit('playerLeft', data.playerId);
            io.to(room.id).emit('playerKickedNotification', { playerName: targetPlayer.name });
            console.log(`👢 ${targetPlayer.name} was kicked from room ${room.id}`);
        }
    });

});

// ============ INTERACTION LOGIC ============
function handleInteraction(player, station, room) {
    switch (station.type) {
        case 'crate':
            handleCrate(player, station, room);
            break;
        case 'counter':
            handleCounter(player, station, room);
            break;
        case 'chopping':
            handleChopping(player, station, room);
            break;
        case 'stove':
            handleStove(player, station, room);
            break;
        case 'oven':
            handleOven(player, station, room);
            break;
        case 'roller':
            handleRoller(player, station, room);
            break;
        case 'serve':
            handleServe(player, station, room);
            break;
        case 'trash':
            handleTrash(player, station, room);
            break;
        case 'plates':
            handlePlates(player, station, room);
            break;
        case 'sink':
            handleSink(player, station, room);
            break;
        case 'seasoning':
            handleSeasoning(player, station, room);
            break;
    }

    emitGameState(room);
}

function handleSeasoning(player, station, room) {
    if (player.holding && !station.contents) {
        // Normal drop logic
        station.contents = player.holding;
        player.holding = null;
    } else if (!player.holding && station.contents) {
        // Normal pickup logic
        player.holding = station.contents;
        station.contents = null;
    } else if (player.holding && station.contents) {
        // Normal combine logic (e.g., adding to plate on seasoning station)
        const combined = tryCombine(player.holding, station.contents, room);
        if (combined) {
            station.contents = combined;
            player.holding = null;
        }
    }
    emitPlayerUpdate(player, room);
}

function handleCrate(player, station, room) {
    // Pick up ingredient from crate
    if (!player.holding) {
        player.holding = {
            type: 'ingredient',
            name: station.ingredient,
            chopped: false,
            cooked: false,
            rolled: false,
            washed: false,
        };
        emitPlayerUpdate(player, room);
    }
}

function handleCounter(player, station, room) {
    if (player.holding && !station.contents) {
        // Place item on counter
        station.contents = player.holding;
        player.holding = null;
    } else if (!player.holding && station.contents) {
        // Pick up from counter
        player.holding = station.contents;
        station.contents = null;
    } else if (player.holding && station.contents) {
        // Try to combine on counter
        const combined = tryCombine(player.holding, station.contents, room);
        if (combined) {
            station.contents = combined;
            player.holding = null;
        } else {
            // Provide helpful error messages when combining fails
            if (player.holding.type === 'ingredient' && station.contents.type === 'plate') {
                const ing = room.activeIngredients[player.holding.name];
                if (player.holding.name === 'dough' && !player.holding.rolled) {
                    io.to(room.id).emit('notification', { msg: '⚪ Roll the dough first!', type: 'error' });
                } else if (player.holding.name === 'rice' && !player.holding.washed) {
                    io.to(room.id).emit('notification', { msg: '🍚 Wash the rice first!', type: 'error' });
                } else if (ing && ing.chopTime > 0 && !player.holding.chopped) {
                    io.to(room.id).emit('notification', { msg: `🔪 Chop the ${ing.emoji} ${ing.name} first!`, type: 'error' });
                } else if ((player.holding.name === 'meat' || player.holding.name === 'fish') && !player.holding.cooked) {
                    // Check if this is for a dish that requires pre-cooking
                    const plateIngredients = station.contents.ingredients || [];
                    const isBurger = plateIngredients.includes('bread') && player.holding.name === 'meat';
                    const isFishTacos = plateIngredients.includes('bread') && player.holding.name === 'fish';

                    if (isBurger || isFishTacos || plateIngredients.length === 0) {
                        io.to(room.id).emit('notification', { msg: `🔥 Cook the ${ing.emoji} ${ing.name} first!`, type: 'error' });
                    } else {
                        io.to(room.id).emit('notification', { msg: 'Cannot add to plate!', type: 'error' });
                    }
                } else {
                    io.to(room.id).emit('notification', { msg: 'Cannot add to plate!', type: 'error' });
                }
            } else {
                io.to(room.id).emit('notification', { msg: 'Cannot combine these items!', type: 'error' });
            }
        }
    }
    emitPlayerUpdate(player, room);
}

function handleChopping(player, station, room) {
    if (player.holding && !station.contents) {
        // Place ingredient for chopping
        if (player.holding.type === 'ingredient') {
            const ing = room.activeIngredients[player.holding.name];
            if (ing && ing.chopTime > 0 && !player.holding.chopped) {
                station.contents = player.holding;
                // PRESERVE PROGRESS: Only reset if ingredient doesn't have existing progress
                if (typeof player.holding.chopProgress !== 'number') {
                    station.chopProgress = 0;
                    player.holding.chopProgress = 0;
                } else {
                    station.chopProgress = player.holding.chopProgress;
                }
                player.holding = null;

                // Emit station update to show progress bar immediately
                io.to(room.id).emit('stationUpdate', {
                    stationId: station.id,
                    station: sanitizeStation(station),
                });
            } else if (player.holding.chopped) {
                io.to(room.id).emit('notification', { msg: 'Already chopped!', type: 'info' });
            }
        }
    } else if (station.contents) {
        // Handling interaction with contents on the board

        if (player.holding && player.holding.type === 'plate') {
            // VALIDATION: Only allow fully chopped items to be plated
            if (station.contents.chopped || !room.activeIngredients[station.contents.name] || room.activeIngredients[station.contents.name].chopTime === 0) {
                const combined = tryCombine(station.contents, player.holding, room);
                if (combined) {
                    player.holding = combined;
                    station.contents = null;
                    station.chopProgress = 0;
                    io.to(room.id).emit('notification', { msg: 'Plated!', type: 'success' });
                } else {
                    io.to(room.id).emit('notification', { msg: 'Cannot add to plate!', type: 'error' });
                }
            } else {
                io.to(room.id).emit('notification', { msg: '🔪 Finish chopping first!', type: 'error' });
            }
        } else if (!player.holding) {
            // VALIDATION: Only allow picking up if fully chopped OR doesn't need chopping
            const ing = room.activeIngredients[station.contents.name];
            if (station.contents.chopped || !ing || ing.chopTime === 0 || station.chopProgress >= 100) {
                player.holding = station.contents;
                station.contents = null;
                station.chopProgress = 0;
            } else {
                // VALIDATION: Cannot pick up until fully chopped
                io.to(room.id).emit('notification', { msg: '🔪 Finish chopping first!', type: 'error' });
            }
        }
    }
    emitPlayerUpdate(player, room);
}

function handleStove(player, station, room) {
    if (player.holding && !station.contents) {
        if (player.holding.type === 'ingredient') {
            const name = player.holding.name;
            const ing = room.activeIngredients[name];

            if (name === 'bread') {
                emitPlayerUpdate(player, room);
                return;
            }
            if (name === 'dough') {
                io.to(room.id).emit('notification', { msg: '⚪ Use the Oven for dough!', type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }
            if (name === 'lettuce') {
                emitPlayerUpdate(player, room);
                return;
            }
            if (name === 'cheese') {
                emitPlayerUpdate(player, room);
                return;
            }
            if (name === 'egg') {
                io.to(room.id).emit('notification', { msg: '🥚 Add egg to a plate with other ingredients, then cook!', type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }

            if (name === 'rice' && !player.holding.washed) {
                io.to(room.id).emit('notification', { msg: '🍚 Wash the rice at the Sink first!', type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }

            if (ing && ing.chopTime > 0 && !player.holding.chopped) {
                io.to(room.id).emit('notification', { msg: `🔪 Chop the ${ing.emoji} ${ing.name} first!`, type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }

            station.contents = player.holding;
            station.cookProgress = 0;
            station.isBurning = false;
            station.cookedNotified = false;
            station.lastChefId = player.id; // Track who placed it
            player.holding = null;
        } else if (player.holding.type === 'plate') {
            const plateIngredients = player.holding.ingredients || [];
            if (plateIngredients.includes('dough')) {
                io.to(room.id).emit('notification', { msg: '🍕 Cook pizza in the Oven, not on the Stove!', type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }
            station.contents = player.holding;
            station.cookProgress = 0;
            station.isBurning = false;
            station.cookedNotified = false;
            station.lastChefId = player.id; // Track who placed it
            player.holding = null;
        }
    } else if (!player.holding && station.contents) {
        // Pick up from stove
        player.holding = station.contents;
        if (station.isBurning || (station.type === 'stove' && station.cookProgress >= 200)) {
            player.holding.burnt = true;
        }
        station.contents = null;
        station.cookProgress = 0;
        station.isBurning = false;
        station.cookedNotified = false;
    } else if (player.holding && station.contents) {
        // Try to add ingredient to pot/pan on stove
        const combined = tryCombine(player.holding, station.contents, room);
        if (combined) {
            station.contents = combined;
            station.lastChefId = player.id; // Track who added ingredient
            player.holding = null;
        }
    }
    emitPlayerUpdate(player, room);
}

function handleOven(player, station, room) {
    if (player.holding && !station.contents) {
        if (player.holding.type === 'ingredient' && player.holding.name === 'dough') {
            if (!player.holding.rolled) {
                io.to(room.id).emit('notification', { msg: '⚪ Roll the dough at the Roller first!', type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }
            io.to(room.id).emit('notification', { msg: '🍕 Put rolled dough on a plate with toppings before baking!', type: 'error' });
            emitPlayerUpdate(player, room);
            return;
        } else if (player.holding.type === 'plate' && player.holding.ingredients.includes('dough')) {
            const doughRolled = player.holding.rolled && player.holding.rolled.includes('dough');
            if (!doughRolled) {
                io.to(room.id).emit('notification', { msg: '⚪ Roll the dough at the Roller first!', type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }

            const tomatoChopped = !player.holding.ingredients.includes('tomato') ||
                (player.holding.chopped && player.holding.chopped.includes('tomato'));
            const cheeseChopped = !player.holding.ingredients.includes('cheese') ||
                (player.holding.chopped && player.holding.chopped.includes('cheese'));
            const hasTomato = player.holding.ingredients.includes('tomato');
            const hasCheese = player.holding.ingredients.includes('cheese');

            if (!tomatoChopped) {
                io.to(room.id).emit('notification', { msg: '🍅 Chop the tomato first!', type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }
            if (!cheeseChopped) {
                io.to(room.id).emit('notification', { msg: '🧀 Chop the cheese first!', type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }
            if (!hasTomato || !hasCheese) {
                io.to(room.id).emit('notification', { msg: '🍕 Add tomato and cheese before baking the pizza!', type: 'error' });
                emitPlayerUpdate(player, room);
                return;
            }

            station.contents = player.holding;
            station.cookProgress = 0;
            station.isBurning = false;
            station.cookedNotified = false;
            station.lastChefId = player.id; // Track who placed it
            player.holding = null;
        } else {
            io.to(room.id).emit('notification', { msg: '🍕 Only Pizza/Dough in the Oven!', type: 'error' });
        }
    } else if (!player.holding && station.contents) {
        player.holding = station.contents;
        if (station.isBurning || (station.type === 'oven' && station.cookProgress >= 200)) {
            player.holding.burnt = true;
        }
        station.contents = null;
        station.cookProgress = 0;
        station.isBurning = false;
        station.cookedNotified = false;
    }
    emitPlayerUpdate(player, room);
}

function handleRoller(player, station, room) {
    if (player.holding && !station.contents) {
        // VALIDATION: Only dough can be rolled
        if (player.holding.type === 'ingredient' && player.holding.name === 'dough') {
            if (!player.holding.rolled) {
                station.contents = player.holding;
                // PRESERVE PROGRESS: Only reset if dough doesn't have existing progress
                if (typeof player.holding.rollProgress !== 'number') {
                    station.rollProgress = 0;
                    player.holding.rollProgress = 0;
                } else {
                    station.rollProgress = player.holding.rollProgress;
                }
                player.holding = null;

                // Emit station update to show progress bar immediately
                io.to(room.id).emit('stationUpdate', {
                    stationId: station.id,
                    station: sanitizeStation(station),
                });
            } else {
                io.to(room.id).emit('notification', { msg: '⚪ Dough already rolled!', type: 'info' });
            }
        } else {
            io.to(room.id).emit('notification', { msg: '⚪ Only dough can be rolled!', type: 'error' });
        }
    } else if (!player.holding && station.contents) {
        // VALIDATION: Only allow picking up if fully rolled
        if (station.contents.rolled || station.rollProgress >= 100) {
            player.holding = station.contents;
            station.contents = null;
            station.rollProgress = 0;
        } else {
            // VALIDATION: Cannot pick up until fully rolled
            io.to(room.id).emit('notification', { msg: '⚪ Finish rolling first!', type: 'error' });
        }
    }
    emitPlayerUpdate(player, room);
}

function handleServe(player, station, room) {
    if (player.holding && player.holding.type === 'plate') {
        const plate = player.holding;
        const evaluation = checkPlateMatchesOrder(plate, room);

        if (evaluation) {
            const matchedOrder = evaluation.order;
            const recipeKey = evaluation.recipeKey;
            const processPenalty = evaluation.processPenalty;

            room.combo++;
            if (room.combo > room.maxCombo) room.maxCombo = room.combo;

            const comboMultiplier = Math.min(room.combo, 5);
            const timeBonus = matchedOrder.expiresAt - Date.now() > ORDER_TIMEOUT * 0.5
                ? matchedOrder.tip : 0;

            // --- NEW: SEASONING BONUS ---
            const seasoningBonus = plate.seasoning ? 8 : 0;

            const basePoints = evaluation.effectiveBasePoints;
            const totalPoints = basePoints + (comboMultiplier - 1) * 5 + timeBonus + seasoningBonus;

            // Score handling: Co-op = shared score, VS = individual scores
            if (room.mode === 'multi_coop') {
                // Co-op: Shared score
                room.score += totalPoints;
                // Also update individual player score for tracking
                player.score += totalPoints;
            } else if (room.mode === 'multi_vs') {
                // VS mode: Individual scores only
                player.score += totalPoints;
                // Room score is sum of all player scores for display
                room.score = Object.values(room.players).reduce((sum, p) => sum + p.score, 0);

                // Emit VS scoreboard update
                const vsScores = {};
                Object.values(room.players).forEach(p => {
                    vsScores[p.id] = p.score;
                });
                io.to(room.id).emit('scoreUpdate', { scores: vsScores });
            } else {
                // Single player: same as room score
                room.score += totalPoints;
                player.score += totalPoints;
            }

            room.ordersCompleted++;
            player.dishesServed++;
            if (processPenalty === 0) {
                room.perfectDishes = (room.perfectDishes || 0) + 1;
                player.perfectDishes = (player.perfectDishes || 0) + 1;
            }

            room.orders = room.orders.filter(o => o.id !== matchedOrder.id);
            player.holding = null;

            io.to(room.id).emit('orderCompleted', {
                orderId: matchedOrder.id,
                recipe: matchedOrder.recipe,
                points: totalPoints,
                combo: room.combo,
                totalScore: room.score,
                playerId: player.id,
                playerScore: player.score,
            });

            let msg = `${room.activeRecipes[recipeKey].emoji} ${room.activeRecipes[recipeKey].name} served! +${totalPoints} pts`;

            io.to(room.id).emit('notification', {
                msg: msg,
                type: 'success',
                playerId: player.id,
                playerName: player.name
            });
        } else {
            room.combo = 0;
            const penaltyPoints = plate.burnt ? 10 : 5;
            const penaltyReason = plate.burnt ? 'Burnt dish!' : 'Wrong recipe!';

            if (room.mode === 'multi_coop') {
                room.score = Math.max(0, room.score - penaltyPoints);
                player.score = Math.max(0, player.score - penaltyPoints);
            } else if (room.mode === 'multi_vs') {
                player.score = Math.max(0, player.score - penaltyPoints);
                room.score = Object.values(room.players).reduce((sum, p) => sum + p.score, 0);
                const vsScores = {};
                Object.values(room.players).forEach(p => { vsScores[p.id] = p.score; });
                io.to(room.id).emit('scoreUpdate', { scores: vsScores });
            } else {
                room.score = Math.max(0, room.score - penaltyPoints);
                player.score = Math.max(0, player.score - penaltyPoints);
            }

            player.holding = null;
            io.to(room.id).emit('notification', {
                msg: `❌ ${penaltyReason} -${penaltyPoints} pts`,
                type: 'error',
                playerId: player.id,
                playerName: player.name
            });
        }
    }
    emitPlayerUpdate(player, room);
}

function handleTrash(player, station, room) {
    if (player.holding) {
        player.holding = null;
        io.to(room.id).emit('trashEffect', { stationId: station.id });
        io.to(room.id).emit('notification', {
            msg: '🗑️ Item trashed',
            type: 'info',
            playerId: player.id,
            playerName: player.name
        });
    }
    emitPlayerUpdate(player, room);
}

function handlePlates(player, station, room) {
    if (!player.holding) {
        player.holding = {
            type: 'plate',
            ingredients: [],
            chopped: [],
            cooked: [],
            rolled: [],
            cookedPlate: false,
        };
    }
    emitPlayerUpdate(player, room);
}

function handleSink(player, station, room) {
    // Sink washes rice (required before cooking)
    if (player.holding && player.holding.type === 'ingredient' && player.holding.name === 'rice') {
        if (!player.holding.washed) {
            // Place rice in sink for washing
            if (!station.contents) {
                station.contents = player.holding;
                // PRESERVE PROGRESS: Only reset if rice doesn't have existing progress
                if (typeof player.holding.washProgress !== 'number') {
                    station.washProgress = 0;
                    player.holding.washProgress = 0;
                } else {
                    station.washProgress = player.holding.washProgress;
                }
                player.holding = null;

                // Emit station update to show progress bar immediately
                io.to(room.id).emit('stationUpdate', {
                    stationId: station.id,
                    station: sanitizeStation(station),
                });

                io.to(room.id).emit('notification', {
                    msg: '🚰 Washing rice... Hold Space!',
                    type: 'info',
                });
            }
        } else {
            io.to(room.id).emit('notification', {
                msg: '🍚 Rice already washed!',
                type: 'info',
            });
        }
    } else if (!player.holding && station.contents) {
        // VALIDATION: Only allow picking up if fully washed
        if (station.contents.washed || station.washProgress >= 100) {
            player.holding = station.contents;
            station.contents = null;
            station.washProgress = 0;
        } else {
            // VALIDATION: Cannot pick up until fully washed
            io.to(room.id).emit('notification', { msg: '🚰 Finish washing first!', type: 'error' });
        }
    } else if (player.holding && player.holding.dirty) {
        // Also handle dirty plates
        player.holding.dirty = false;
        io.to(room.id).emit('notification', {
            msg: '🧼 Plate cleaned!',
            type: 'info',
        });
    }
    emitPlayerUpdate(player, room);
}

// ============ ITEM COMBINING ============
function tryCombine(itemA, itemB, room) {
    if (itemA.type === 'ingredient' && itemB.type === 'plate') {
        const ingName = itemA.name;
        const ing = room ? room.activeIngredients[ingName] : INGREDIENTS[ingName];

        if (ingName === 'dough' && !itemA.rolled) {
            return null;
        }

        if (ingName === 'rice' && !itemA.washed) {
            return null;
        }

        if (ing && ing.chopTime > 0 && !itemA.chopped) {
            return null;
        }

        if (room && (ingName === 'meat' || ingName === 'fish')) {
            const plateIngredients = itemB.ingredients || [];

            const isBurger = plateIngredients.includes('bread') && ingName === 'meat';
            const isFishTacos = plateIngredients.includes('bread') && ingName === 'fish';

            if ((isBurger || isFishTacos) && !itemA.cooked) {
                return null;
            }

            if (plateIngredients.length === 0) {
                let needsPreCooking = false;

                if (room.activeRecipes) {
                    if (room.activeRecipes.burger && ingName === 'meat') {
                        needsPreCooking = true;
                    }
                    if (room.activeRecipes.fish_tacos && ingName === 'fish') {
                        needsPreCooking = true;
                    }
                }

                if (needsPreCooking && !itemA.cooked) {
                    return null;
                }
            }
        }

        if (!itemB.ingredients.includes(itemA.name)) {
            const plate = { ...itemB };
            plate.ingredients = [...itemB.ingredients, itemA.name];
            if (itemA.chopped) plate.chopped = [...(itemB.chopped || []), itemA.name];
            if (itemA.cooked) plate.cooked = [...(itemB.cooked || []), itemA.name];
            if (itemA.rolled) plate.rolled = [...(itemB.rolled || []), itemA.name];
            if (itemA.washed) plate.washed = [...(itemB.washed || []), itemA.name];
            if (itemA.burnt) plate.burnt = true;
            plate.cookedPlate = false;

            if (!plate.platedAt) plate.platedAt = Date.now();

            return plate;
        }
    }
    // Combine plate + ingredient (reversed)
    if (itemB.type === 'ingredient' && itemA.type === 'plate') {
        return tryCombine(itemB, itemA, room);
    }
    return null;
}

// ============ GAME LOOP ============
function startGame(room) {
    if (room.state !== 'lobby' || room.isStarting) return;
    clearTimers(room);
    room.isStarting = true;

    // Start at 5: 5-4 are "Preparing", 3-1 are countdown
    let countdown = 5;

    room.countdownTimer = setInterval(() => {
        io.to(room.id).emit('gameCountdown', { countdown });
        countdown--;
        if (countdown < 0) {
            if (room.countdownTimer) {
                clearInterval(room.countdownTimer);
                room.countdownTimer = null;
            }
            finalizeGameStart(room);
        }
    }, 1000);
}

function finalizeGameStart(room) {
    room.isStarting = false;
    room.state = 'playing';
    room.timeLeft = GAME_DURATION;
    room.gameStartAt = Date.now();
    room.gameSessionId = `${room.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; // Unique game session ID
    room.score = 0;
    room.combo = 0;
    room.maxCombo = 0;
    room.orders = [];
    room.ordersCompleted = 0;
    room.ordersFailed = 0;
    room.perfectDishes = 0;
    room.droppedItems = {};

    // Clear any old disconnected players from previous game sessions in this room
    Object.keys(disconnectedPlayers).forEach(userId => {
        if (disconnectedPlayers[userId].roomId === room.id) {
            console.log(`🧹 Clearing old disconnected player ${userId} from previous game session`);
            delete disconnectedPlayers[userId];
        }
    });

    Object.values(room.stations).forEach(s => {
        s.contents = null;
        s.cookProgress = 0;
        s.chopProgress = 0;
        s.isBurning = false;
        s.isDirty = false;
    });

    Object.values(room.players).forEach((p, i) => {
        p.holding = null;
        p.score = 0;
        p.dishesServed = 0;
        p.perfectDishes = 0;
        p.isChopping = false;
    });

    generateOrder(room);
    generateOrder(room);

    io.to(room.id).emit('gameStarted', {
        timeLeft: room.timeLeft,
        orders: room.orders,
    });

    // Broadcast status update for all players in room
    Object.keys(room.players).forEach(sid => {
        const uid = socketToUser[sid];
        if (uid) broadcastStatusUpdate(uid);
    });

    room.orderTimer = setInterval(() => {
        if (room.isPaused) return; // Skip if paused
        const order = generateOrder(room);
        if (order) {
            io.to(room.id).emit('newOrder', order);
        }
    }, ORDER_INTERVAL);

    room.gameTimer = setInterval(() => {
        if (!room.gameStartAt || room.isPaused) {
            if (room.isPaused) {
                console.log(`⏸️ Timer skipped - room ${room.id} is paused`);
            }
            return; // Skip if paused
        }

        // Calculate exact time remaining to prevent timer running too fast
        const currentTime = Date.now();
        const elapsedSeconds = Math.floor((currentTime - room.gameStartAt) / 1000);
        const remaining = Math.max(0, GAME_DURATION - elapsedSeconds);

        if (remaining !== room.timeLeft) {
            room.timeLeft = remaining;
            io.to(room.id).emit('timeUpdate', room.timeLeft);
            if (room.timeLeft <= 0) {
                endGame(room);
            }
        }
    }, 1000);

    room.tickTimer = setInterval(() => {
        if (room.isPaused) return; // Skip if paused
        tickGame(room);
    }, TICK_RATE);
}

function tickGame(room) {
    checkOrderExpiry(room);

    // --- RARE SEASONING SPAWN LOGIC (Timed Station Effect) ---
    if (Math.random() < 0.008) { // Increased chance since it only lasts 5s
        const seasoningStations = Object.values(room.stations).filter(s => s.type === 'seasoning' && !s.rareSeasoning);
        if (seasoningStations.length > 0) {
            const st = seasoningStations[Math.floor(Math.random() * seasoningStations.length)];
            st.rareSeasoning = st.ingredient; // 'salt' or 'sauce'
            st.rareSeasoningExpires = Date.now() + 5000; // 5 seconds duration

            io.to(room.id).emit('stationUpdate', {
                stationId: st.id,
                station: sanitizeStation(st)
            });
            console.log(`✨ Rare Seasoning Active: ${st.ingredient} at ${st.id} (5s)`);
        }
    }

    // --- RARE SEASONING EXPIRY CLEANUP ---
    Object.values(room.stations).forEach(st => {
        if (st.rareSeasoning && Date.now() > st.rareSeasoningExpires) {
            st.rareSeasoning = null;
            st.rareSeasoningExpires = null;
            st.garnishProgress = 0; // Reset progress if it expired
            io.to(room.id).emit('stationUpdate', {
                stationId: st.id,
                station: sanitizeStation(st)
            });
        }
    });

    // --- DROPPED ITEMS PHYSICS ---
    if (room.droppedItems) {
        Object.values(room.droppedItems).forEach(item => {
            let inMotion = item.y > 0 || Math.abs(item.vx) > 0.01 || Math.abs(item.vz) > 0.01;

            // Pushable by players (overlap check)
            Object.values(room.players).forEach(p => {
                const px = p.posX !== undefined ? p.posX : p.gridX * TILE_SIZE;
                const pz = p.posZ !== undefined ? p.posZ : p.gridZ * TILE_SIZE;
                const dist = Math.sqrt(Math.pow(item.x - px, 2) + Math.pow(item.z - pz, 2));
                if (dist < TILE_SIZE * 0.9) {
                    item.vx += (item.x - px) * 0.04;
                    item.vz += (item.z - pz) * 0.04;
                    inMotion = true;
                }
            });

            if (inMotion) {
                // Apply gravity
                item.vy -= 0.1;
                item.y += item.vy;

                // Track old position in case of collision
                const oldX = item.x;
                const oldZ = item.z;

                item.x += item.vx;
                item.z += item.vz;

                // Station collision (simple bounding box check)
                // Treat item as a small sphere and station as a tile box
                const itemGridX = Math.round(item.x / TILE_SIZE);
                const itemGridZ = Math.round(item.z / TILE_SIZE);

                let hitStation = false;
                let landedOnTable = false;

                for (const [id, st] of Object.entries(room.stations)) {
                    if (st.gridX === itemGridX && st.gridZ === itemGridZ) {
                        const oldGridX = Math.round(oldX / TILE_SIZE);
                        const oldGridZ = Math.round(oldZ / TILE_SIZE);

                        // If item is below table height AND crossed grid lines into a table
                        if (item.y < 1.2 && (oldGridX !== itemGridX || oldGridZ !== itemGridZ)) {
                            // Hit the side of the table
                            item.x = oldX;
                            item.z = oldZ;
                            item.vx *= -0.4; // Reverse direction and dampen heavily
                            item.vz *= -0.4;
                            hitStation = true;
                        }
                        // If item is falling from above down ONTO the table
                        else if (item.y <= 1.2 && item.vy < 0) {
                            landedOnTable = true;
                        }
                        break;
                    }
                }

                // Floor collision or Table Collision
                const groundLevel = landedOnTable ? 1.2 : 0;

                if (item.y <= groundLevel) {
                    // Check if we landed on a trash bin
                    if (landedOnTable) {
                        for (const [id, st] of Object.entries(room.stations)) {
                            if (st.gridX === itemGridX && st.gridZ === itemGridZ && st.type === 'trash') {
                                // Submitting to trash!
                                delete room.droppedItems[item.id];
                                io.to(room.id).emit('itemPickedUp', { itemId: item.id, trashed: true });
                                io.to(room.id).emit('trashEffect', { stationId: st.id });
                                return;
                            }
                        }
                    }

                    item.y = groundLevel;
                    item.vy = -item.vy * 0.2; // Severely reduced bounce

                    if (hitStation || landedOnTable) {
                        // Add extra friction if it hit a counter to prevent sliding on it
                        item.vx *= 0.3;
                        item.vz *= 0.3;
                    } else {
                        // Normal floor friction
                        item.vx *= 0.6;
                        item.vz *= 0.6;
                    }

                    if (Math.abs(item.vy) < 0.1) item.vy = 0;
                    if (Math.abs(item.vx) < 0.01) item.vx = 0;
                    if (Math.abs(item.vz) < 0.01) item.vz = 0;
                }

                // Map bounds
                const maxX = room.config.GRID_W * TILE_SIZE;
                const maxZ = room.config.GRID_H * TILE_SIZE;

                if (item.x < 0) { item.x = 0; item.vx *= -0.4; }
                if (item.x > maxX) { item.x = maxX; item.vx *= -0.4; }
                if (item.z < 0) { item.z = 0; item.vz *= -0.4; }
                if (item.z > maxZ) { item.z = maxZ; item.vz *= -0.4; }

                // Emit updates for items in motion occasionally or every tick
                io.to(room.id).emit('droppedItemUpdate', { itemId: item.id, x: item.x, y: item.y, z: item.z });
            }
        });
    }

    // Update stoves & ovens (cooking progress)
    Object.values(room.stations).forEach(station => {
        if ((station.type === 'stove' || station.type === 'oven') && station.contents) {
            const contents = station.contents;

            // Find which recipe could be cooking
            let cookTime = 5000; // default
            if (contents.type === 'plate' && contents.ingredients.length > 0) {
                // Check recipes for cook time
                for (const [key, recipe] of Object.entries(room.activeRecipes)) {
                    if (recipe.requiresCooking.length > 0) {
                        const hasAll = recipe.requiresCooking.some(ing =>
                            contents.ingredients.includes(ing)
                        );
                        if (hasAll) {
                            cookTime = recipe.cookTime;
                            break;
                        }
                    }
                }
            } else if (contents.type === 'ingredient') {
                const ing = room.activeIngredients[contents.name];
                if (ing) {
                    // Meat cooks in 5s, Veggies in 4s, Fish/Soup in 6s
                    if (contents.name === 'meat') cookTime = 5000;
                    else if (['fish', 'mushroom', 'onion'].includes(contents.name)) cookTime = 6000;
                    else cookTime = 4000;
                }
            }

            station.cookProgress += (TICK_RATE / cookTime) * 100;

            if (station.cookProgress >= 100 && !station.cookedNotified) {
                if (contents.type === 'ingredient') {
                    contents.cooked = true;
                } else if (contents.type === 'plate') {
                    contents.ingredients.forEach(ing => {
                        if (!contents.cooked) contents.cooked = [];
                        if (!contents.cooked.includes(ing)) contents.cooked.push(ing);
                    });
                    contents.cookedPlate = true;
                }
                station.cookedNotified = true;

                // Track item cooked for the player who last interacted with this station
                if (station.lastChefId && room.players[station.lastChefId]) {
                    room.players[station.lastChefId].itemsCooked = (room.players[station.lastChefId].itemsCooked || 0) + 1;
                }

                io.to(room.id).emit('cookComplete', { stationId: station.id });
                console.log(`🍳 Station ${station.id} finished cooking.`);
            }

            if (station.cookProgress >= 200 && !station.isBurning) {
                // BURNING! (5 seconds after being done)
                station.isBurning = true;

                // Track burnt food for the player who last interacted with this station or for the room
                room.burntFood = (room.burntFood || 0) + 1;
                if (station.lastChefId && room.players[station.lastChefId]) {
                    room.players[station.lastChefId].burntFood = (room.players[station.lastChefId].burntFood || 0) + 1;
                }

                io.to(room.id).emit('burning', {
                    stationId: station.id,
                });
                console.log(`🔥 Station ${station.id} is now BURNING!`);
            }

            if (station.cookProgress >= 300) {
                // Fire! Destroy contents
                station.contents = null;
                station.cookProgress = 0;
                station.isBurning = false;
                station.cookedNotified = false;

                const penaltyPoints = 10;
                if (room.mode === 'multi_coop' || !room.mode) {
                    room.score = Math.max(0, room.score - penaltyPoints);
                    Object.values(room.players).forEach(p => {
                        p.score = Math.max(0, p.score - penaltyPoints);
                    });
                } else if (room.mode === 'multi_vs') {
                    Object.values(room.players).forEach(p => {
                        p.score = Math.max(0, p.score - penaltyPoints);
                    });
                    room.score = Object.values(room.players).reduce((sum, p) => sum + p.score, 0);
                    const vsScores = {};
                    Object.values(room.players).forEach(p => { vsScores[p.id] = p.score; });
                    io.to(room.id).emit('scoreUpdate', { scores: vsScores });
                }

                io.to(room.id).emit('fire', {
                    stationId: station.id,
                    score: room.score,
                });
                io.to(room.id).emit('notification', {
                    msg: `🔥 FIRE! Food destroyed! -${penaltyPoints} pts`,
                    type: 'error',
                    // Note: Fire applies to the room/station, not a specific player acting right now,
                    // but we can leave it as a general alert, or if we tracked who left it, blame them.
                    // For now, general alert is fine.
                });
            }

            io.to(room.id).emit('stationUpdate', {
                stationId: station.id,
                station: sanitizeStation(station),
            });
        }
    });
}

function endGame(room) {
    console.log(`🏁 Game Over in room ${room.id}. Score: ${room.score}`);
    room.state = 'gameover';
    room.gameSessionId = null; // Clear game session ID when game ends
    clearTimers(room);

    if (room.score > (room.highScore || 0)) {
        room.highScore = room.score;
    }

    const chefPoints = Math.floor(room.score / 10);

    // Update user stats for all players who are registered users or guests
    try {
        Object.values(room.players).forEach(player => {
            if (player.userId && users[player.userId]) {
                const user = users[player.userId];
                const stats = user.stats;

                // Check for new achievements BEFORE updating stats
                const newAchievements = checkAchievements(user, player, room);
                if (newAchievements && newAchievements.length > 0) {
                    if (!stats.achievements) stats.achievements = [];
                    stats.achievements.push(...newAchievements);
                    console.log(`🏆 New achievements for ${user.username}: ${newAchievements.map(a => a.name).join(', ')}`);
                }

                // Increment games played
                stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;

                // Track co-op games
                if (room.mode === 'multi_coop') {
                    stats.coopGames = (stats.coopGames || 0) + 1;
                }

                // Update running totals
                stats.perfectDishes = (stats.perfectDishes || 0) + (player.perfectDishes || 0);
                stats.itemsChopped = (stats.itemsChopped || 0) + (player.itemsChopped || 0);
                stats.itemsCooked = (stats.itemsCooked || 0) + (player.itemsCooked || 0);
                stats.burntFood = (stats.burntFood || 0) + (player.burntFood || 0);
                stats.failedOrders = (stats.failedOrders || 0) + (room.ordersFailed || 0);

                if (room.maxCombo > (stats.bestStreak || 0)) {
                    stats.bestStreak = room.maxCombo;
                }

                // --- WIN CALCULATION ---
                let xpGain = 10;
                let won = false;
                let isTie = false;

                if (room.mode === 'multi_vs') {
                    // Find highest score in room
                    const allPlayers = Object.values(room.players);
                    const scores = allPlayers.map(p => p.score || 0);
                    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
                    const maxScorers = scores.filter(s => s === maxScore);
                    const isTied = allPlayers.length > 1 && maxScorers.length > 1;

                    // If player has max score
                    if (player.score === maxScore && player.score > 0) {
                        stats.wins = (stats.wins || 0) + 1;
                        if (isTied) {
                            isTie = true;
                            xpGain = 10; // Tie
                        } else {
                            won = true;
                            xpGain = 20; // Win
                        }
                    } else if (player.score === maxScore && player.score === 0 && isTied) {
                        isTie = true; // Tied at 0 points is essentially a loss/draw
                        xpGain = 5;
                    } else {
                        xpGain = 5; // Loss
                    }
                } else if (room.mode === 'single' || room.mode === 'multi_coop') {
                    // In Coop/Single, a "Win" is reaching some goal (e.g. 100 points)
                    if (player.score >= 100) {
                        stats.wins = (stats.wins || 0) + 1;
                        won = true;
                    }
                }

                // Store on player object to send to client
                player.xpGain = xpGain;
                player.won = won;
                player.isTie = isTie;

                // --- PROGRESS SYSTEM: +XP PER GAME ---
                user.xp = (user.xp || 0) + xpGain;

                // LEVEL UP LOGIC: level 1->2 needs 50, 2->3 needs 100, etc. (level * 50)
                if (!user.level || user.level < 1) user.level = 1;
                let xpToNext = user.level * 50;
                while (user.xp >= xpToNext) {
                    user.xp -= xpToNext;
                    user.level++;
                    xpToNext = user.level * 50;
                    console.log(`🆙 ${user.username} LEVELED UP to Level ${user.level}!`);

                    // Could emit a level-up notification here if player is connected
                    const playerSocketId = Object.keys(socketToUser).find(sid => socketToUser[sid] === player.userId);
                    if (playerSocketId) {
                        io.to(playerSocketId).emit('notification', {
                            msg: `🎉 LEVEL UP! You are now Level ${user.level}!`,
                            type: 'success'
                        });
                    }
                }

                // Add score to total
                stats.scoreTotal = (stats.scoreTotal || 0) + (player.score || 0);

                // Add dishes served to total
                stats.dishesServed = (stats.dishesServed || 0) + (player.dishesServed || 0);

                // Calculate chef hat points: 3 per dish + bonus based on performance
                const dishPoints = (player.dishesServed || 0) * 3;
                const performanceBonus = Math.floor((player.score || 0) / 50); // 1 bonus point per 50 score
                const newChefPoints = dishPoints + performanceBonus;
                stats.chefHatPoints = (stats.chefHatPoints || 0) + newChefPoints;

                // Store on player object to send to client
                player.newChefPoints = newChefPoints;

                // Add game score to history
                if (!stats.gameScores) stats.gameScores = [];

                let opponentName = null;
                if (room.mode === 'multi_vs') {
                    const opponents = Object.values(room.players).filter(p => p.id !== player.id);
                    opponentName = opponents.map(o => o.name).join(', ') || 'Unknown';
                }

                stats.gameScores.push({
                    score: player.score || 0,
                    dishesServed: player.dishesServed || 0,
                    perfectDishes: player.perfectDishes || 0,
                    itemsChopped: player.itemsChopped || 0,
                    itemsCooked: player.itemsCooked || 0,
                    burntFood: player.burntFood || 0,
                    date: Date.now(),
                    mode: room.mode,
                    xpEarned: xpGain,
                    chefHatEarned: newChefPoints,
                    opponent: opponentName,
                    won: won,
                    isTie: isTie
                });

                // Keep only last 12 games
                if (stats.gameScores.length > 12) {
                    stats.gameScores = stats.gameScores.slice(-12);
                }

                // Persist user data
                persistUser(player.userId);

                // Send updated profile to client
                const socketId = userToSocket[player.userId];
                if (socketId) {
                    const user = users[player.userId];
                    const stats = user.stats;

                    // Calculate additional computed stats
                    const totalAchievements = stats.achievements.length;
                    const averageScore = stats.gamesPlayed > 0 ? Math.round(stats.scoreTotal / stats.gamesPlayed) : 0;
                    const averageDishes = stats.gamesPlayed > 0 ? Math.round(stats.dishesServed / stats.gamesPlayed) : 0;

                    // Group achievements by type
                    const achievementGroups = {
                        score: stats.achievements.filter(a => a.id.includes('score_')).length,
                        dishes: stats.achievements.filter(a => a.id.includes('dishes_')).length,
                        special: stats.achievements.filter(a => !a.id.includes('score_') && !a.id.includes('dishes_') && !a.id.includes('games_')).length,
                        veteran: stats.achievements.filter(a => a.id.includes('games_')).length
                    };

                    // Recent games (last 12)
                    const recentGames = stats.gameScores.slice(-12).reverse();

                    const profile = {
                        id: user.id,
                        username: user.username,
                        name: user.name,
                        type: user.type,
                        profileImage: user.profileImage,
                        profileColor: user.profileColor,
                        title: user.title,
                        bio: user.bio,
                        createdAt: user.createdAt,
                        stats: {
                            ...stats,
                            // Computed fields
                            averageScore,
                            averageDishes,
                            totalAchievements,
                            achievementGroups,
                            recentGames
                        },
                        friends: user.friends || []
                    };

                    io.to(socketId).emit('userProfile', profile);
                }
            }
        });
    } catch (err) {
        console.error('❌ Error updating user stats in endGame:', err);
    }

    io.to(room.id).emit('gameOver', {
        mode: room.mode,
        score: room.score,
        highScore: room.highScore,
        ordersCompleted: room.ordersCompleted,
        ordersFailed: room.ordersFailed || 0,
        perfectDishes: room.perfectDishes || 0,
        maxCombo: room.maxCombo,
        chefPoints,
        players: Object.values(room.players).map(p => ({
            id: p.id,
            name: p.name,
            score: p.score || 0,
            dishesServed: p.dishesServed || 0,
            perfectDishes: p.perfectDishes || 0,
            chefPoints: p.newChefPoints || 0,
            xpGain: p.xpGain || 10,
            won: !!p.won,
            isTie: !!p.isTie,
            color: p.color,
        })),
    });

    // Broadcast status update for all players in room (back to lobby/gameover)
    Object.keys(room.players).forEach(sid => {
        const uid = socketToUser[sid];
        if (uid) broadcastStatusUpdate(uid);
    });
}

function restartGame(room) {
    clearTimers(room);
    room.state = 'lobby';
    room.orders = [];
    room.score = 0;
    room.timeLeft = GAME_DURATION;
    room.gameSessionId = null; // Clear game session ID when returning to lobby

    // Reset stations
    Object.values(room.stations).forEach(s => {
        s.contents = null;
        s.cookProgress = 0;
        s.chopProgress = 0;
        s.isBurning = false;
    });

    // Reset players
    Object.values(room.players).forEach(p => {
        p.holding = null;
        p.score = 0;
        p.dishesServed = 0;
    });

    io.to(room.id).emit('gameRestarted', {
        room: {
            id: room.id,
            players: room.players,
            stations: room.stations,
            orders: [],
            score: 0,
            timeLeft: GAME_DURATION,
            state: 'lobby',
        }
    });

    // Broadcast status update for all players in room (back to lobby)
    Object.keys(room.players).forEach(sid => {
        const uid = socketToUser[sid];
        if (uid) broadcastStatusUpdate(uid);
    });

    // Auto-start single player games immediately on restart
    if (room.mode === 'single') {
        startGame(room);
    }
}

function clearTimers(room) {
    if (room.orderTimer) clearInterval(room.orderTimer);
    if (room.gameTimer) clearInterval(room.gameTimer);
    if (room.tickTimer) clearInterval(room.tickTimer);
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    room.orderTimer = null;
    room.gameTimer = null;
    room.tickTimer = null;
    room.countdownTimer = null;
    room.isStarting = false;
    room.gameStartAt = null;
}

// ============ HELPERS ============
function findPlayer(socketId) {
    for (const room of Object.values(rooms)) {
        if (room.players[socketId]) {
            return room.players[socketId];
        }
    }
    return null;
}

function sanitizeStation(station) {
    return {
        id: station.id,
        type: station.type,
        gridX: station.gridX,
        gridZ: station.gridZ,
        contents: station.contents,
        cookProgress: station.cookProgress,
        chopProgress: station.chopProgress,
        rollProgress: station.rollProgress,
        washProgress: station.washProgress,
        garnishProgress: station.garnishProgress,
        isBurning: station.isBurning,
        isDirty: station.isDirty,
        ingredient: station.ingredient,
    };
}

function emitPlayerUpdate(player, room) {
    io.to(room.id).emit('playerUpdate', {
        id: player.id,
        gridX: player.gridX, // Keep sending grid for compatibility or interactions
        gridZ: player.gridZ,
        x: player.posX,      // Send actual float pos
        z: player.posZ,
        facing: player.facing,
        holding: player.holding,
        score: player.score,
    });
}

function emitGameState(room) {
    const stationsData = {};
    Object.entries(room.stations).forEach(([id, s]) => {
        stationsData[id] = sanitizeStation(s);
    });

    io.to(room.id).emit('gameStateUpdate', {
        stations: stationsData,
        orders: room.orders,
        score: room.score,
        timeLeft: room.timeLeft,
    });
}


