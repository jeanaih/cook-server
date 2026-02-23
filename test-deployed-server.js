/**
 * Test Deployed Server Script
 * Tests if the deployed backend is working properly
 */

const https = require('https');

const BACKEND_URL = 'https://cook-server-production.up.railway.app';

console.log('🔍 Testing Deployed Server...');
console.log('📍 Backend URL:', BACKEND_URL);
console.log('');

// Helper function to make HTTP requests
function testEndpoint(path, description) {
    return new Promise((resolve, reject) => {
        const url = BACKEND_URL + path;
        console.log(`🔄 Testing: ${description}`);
        console.log(`   URL: ${url}`);
        
        https.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    console.log(`   ✅ Status: ${res.statusCode}`);
                    console.log(`   📦 Response:`, JSON.stringify(json, null, 2));
                    console.log('');
                    resolve({ success: true, data: json, status: res.statusCode });
                } catch (e) {
                    console.log(`   ⚠️  Status: ${res.statusCode}`);
                    console.log(`   📦 Response (not JSON):`, data.substring(0, 200));
                    console.log('');
                    resolve({ success: false, data: data, status: res.statusCode });
                }
            });
        }).on('error', (err) => {
            console.log(`   ❌ Error: ${err.message}`);
            console.log('');
            reject(err);
        });
    });
}

async function runTests() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  DEPLOYED SERVER DIAGNOSTICS');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    try {
        // Test 1: Server Status
        const statusResult = await testEndpoint('/status', 'Server Status');
        
        if (statusResult.success) {
            const status = statusResult.data;
            console.log('📊 Server Status Analysis:');
            console.log(`   - Server: ${status.status === 'online' ? '✅ Online' : '❌ Offline'}`);
            console.log(`   - Database: ${status.database === 'connected' ? '✅ Connected' : '❌ Disconnected'}`);
            console.log(`   - Total Users: ${status.userCount || 0}`);
            console.log(`   - Accounts: ${status.accountCount || 0}`);
            console.log(`   - Guests: ${status.guestCount || 0}`);
            console.log(`   - Version: ${status.version || 'unknown'}`);
            console.log('');

            if (status.database !== 'connected') {
                console.log('⚠️  WARNING: Database is not connected!');
                console.log('   This means Firebase is not working on the deployed server.');
                console.log('');
            }

            if (status.accountCount === 0) {
                console.log('⚠️  WARNING: No accounts loaded!');
                console.log('   This means users cannot login.');
                console.log('');
            }
        }

        // Test 2: Firebase Connection
        const firebaseResult = await testEndpoint('/test-firebase', 'Firebase Connection');
        
        if (firebaseResult.success) {
            const firebase = firebaseResult.data;
            console.log('🔥 Firebase Status Analysis:');
            console.log(`   - Status: ${firebase.status === 'success' ? '✅ Success' : '❌ Failed'}`);
            console.log(`   - Connected: ${firebase.connected ? '✅ Yes' : '❌ No'}`);
            console.log(`   - Message: ${firebase.message || 'N/A'}`);
            
            if (firebase.errorCode) {
                console.log(`   - Error Code: ${firebase.errorCode}`);
                console.log(`   - Error: ${firebase.message}`);
            }
            console.log('');

            if (!firebase.connected) {
                console.log('❌ PROBLEM FOUND: Firebase is not connected!');
                console.log('');
                console.log('🔍 Possible Causes:');
                console.log('   1. serviceAccountKey.json was not deployed');
                console.log('   2. serviceAccountKey.json has invalid credentials');
                console.log('   3. FIREBASE_CONFIG environment variable not set');
                console.log('   4. Firebase project is disabled or deleted');
                console.log('');
                console.log('💡 Solutions:');
                console.log('   1. Check Railway/Render deployment logs');
                console.log('   2. Verify serviceAccountKey.json was pushed');
                console.log('   3. Set FIREBASE_CONFIG environment variable');
                console.log('   4. Check Firebase Console project status');
                console.log('');
            }
        }

        // Test 3: Debug Users
        const usersResult = await testEndpoint('/debug/users', 'User List');
        
        if (usersResult.success) {
            const users = usersResult.data;
            console.log('👥 Users Analysis:');
            console.log(`   - Total Users: ${users.totalUsers || 0}`);
            console.log(`   - Accounts: ${users.accounts || 0}`);
            console.log(`   - Guests: ${users.guests || 0}`);
            console.log(`   - Online: ${users.online || 0}`);
            console.log('');

            if (users.users && users.users.length > 0) {
                console.log('   📋 User List:');
                users.users.forEach(user => {
                    const onlineStatus = user.online ? '🟢' : '⚪';
                    console.log(`      ${onlineStatus} ${user.username} (${user.type}) - Level ${user.level || 1}`);
                });
                console.log('');
            } else {
                console.log('   ⚠️  No users found in server memory!');
                console.log('');
            }
        }

        // Summary
        console.log('═══════════════════════════════════════════════════════');
        console.log('  SUMMARY');
        console.log('═══════════════════════════════════════════════════════');
        console.log('');

        const allGood = 
            statusResult.success && 
            statusResult.data.database === 'connected' &&
            statusResult.data.accountCount > 0;

        if (allGood) {
            console.log('✅ ALL TESTS PASSED!');
            console.log('   Your deployed server is working correctly.');
            console.log('   Users should be able to login.');
            console.log('');
        } else {
            console.log('❌ ISSUES FOUND!');
            console.log('');
            
            if (!statusResult.success) {
                console.log('   ❌ Server is not responding');
                console.log('      - Check if deployment is running');
                console.log('      - Check deployment logs');
                console.log('');
            } else if (statusResult.data.database !== 'connected') {
                console.log('   ❌ Firebase is not connected');
                console.log('      - Check serviceAccountKey.json');
                console.log('      - Check FIREBASE_CONFIG env variable');
                console.log('      - Check deployment logs for Firebase errors');
                console.log('');
            } else if (statusResult.data.accountCount === 0) {
                console.log('   ❌ No users loaded from Firebase');
                console.log('      - Check Firebase Console → Firestore');
                console.log('      - Verify users collection exists');
                console.log('      - Check if users have data');
                console.log('');
            }

            console.log('📖 Next Steps:');
            console.log('   1. Check deployment logs for errors');
            console.log('   2. Verify Firebase credentials are correct');
            console.log('   3. Check if serviceAccountKey.json was deployed');
            console.log('   4. Try setting FIREBASE_CONFIG environment variable');
            console.log('');
        }

    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        console.log('');
        console.log('🔍 Possible Causes:');
        console.log('   - Server is not running');
        console.log('   - Network connection issue');
        console.log('   - Invalid backend URL');
        console.log('');
    }
}

// Run tests
runTests().then(() => {
    console.log('═══════════════════════════════════════════════════════');
    console.log('Test complete!');
    console.log('═══════════════════════════════════════════════════════');
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
