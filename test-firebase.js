/**
 * Firebase Connection Test Script
 * Run this to test if your Firebase credentials are working
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

console.log('🔥 Testing Firebase Connection...\n');

const FIREBASE_KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');

// Check if file exists
if (!fs.existsSync(FIREBASE_KEY_PATH)) {
    console.error('❌ ERROR: serviceAccountKey.json not found!');
    console.log('📍 Expected location:', FIREBASE_KEY_PATH);
    console.log('\n💡 Solution: Download a new service account key from Firebase Console');
    process.exit(1);
}

console.log('✅ serviceAccountKey.json found');

try {
    // Load the service account
    const serviceAccount = require(FIREBASE_KEY_PATH);
    console.log('✅ Service account JSON is valid');
    console.log('📧 Service account email:', serviceAccount.client_email);
    console.log('🆔 Project ID:', serviceAccount.project_id);
    console.log('');

    // Initialize Firebase
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase Admin SDK initialized');

    const db = admin.firestore();
    console.log('✅ Firestore instance created');
    console.log('');

    // Test connection by reading users collection
    console.log('🔄 Testing Firestore connection...');
    db.collection('users').limit(1).get()
        .then(snapshot => {
            console.log('✅ SUCCESS! Firebase connection is working!');
            console.log('📊 Users collection accessible');
            console.log('👥 Sample size:', snapshot.size);
            
            if (snapshot.empty) {
                console.log('\n⚠️  WARNING: Users collection is empty');
                console.log('💡 This is normal for a new project');
            } else {
                console.log('\n📋 Sample user data:');
                snapshot.forEach(doc => {
                    const data = doc.data();
                    console.log(`   - ${doc.id}: ${data.username || data.name} (${data.type})`);
                });
            }

            console.log('\n✨ All tests passed! Your Firebase credentials are working correctly.');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ FIREBASE CONNECTION ERROR!');
            console.error('Error code:', error.code);
            console.error('Error message:', error.message);
            console.log('\n🔍 Common causes:');
            
            if (error.message.includes('UNAUTHENTICATED')) {
                console.log('   1. Service account key is expired or revoked');
                console.log('   2. Service account doesn\'t have proper permissions');
                console.log('   3. Firebase project is disabled or deleted');
                console.log('\n💡 Solution:');
                console.log('   1. Go to Firebase Console: https://console.firebase.google.com/');
                console.log('   2. Select your project');
                console.log('   3. Go to Project Settings → Service Accounts');
                console.log('   4. Click "Generate New Private Key"');
                console.log('   5. Replace serviceAccountKey.json with the new file');
            } else if (error.message.includes('PERMISSION_DENIED')) {
                console.log('   1. Service account doesn\'t have Firestore permissions');
                console.log('   2. Firestore rules are too restrictive');
                console.log('\n💡 Solution:');
                console.log('   1. Go to Firebase Console → Firestore Database');
                console.log('   2. Check your security rules');
                console.log('   3. Verify service account has proper IAM roles');
            } else {
                console.log('   - Check your internet connection');
                console.log('   - Verify Firebase project is active');
                console.log('   - Check Firebase billing status');
            }
            
            process.exit(1);
        });

} catch (error) {
    console.error('\n❌ ERROR:', error.message);
    
    if (error.message.includes('Unexpected token')) {
        console.log('\n🔍 The serviceAccountKey.json file is corrupted or invalid');
        console.log('💡 Solution: Download a fresh copy from Firebase Console');
    }
    
    process.exit(1);
}
