const admin = require('firebase-admin');
const config = require('./index');

let firebaseApp = null;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  if (!config.fcm.projectId || !config.fcm.clientEmail || !config.fcm.privateKey) {
    console.warn('[FCM] Firebase credentials not configured. Push notifications disabled.');
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.fcm.projectId,
        clientEmail: config.fcm.clientEmail,
        privateKey: config.fcm.privateKey,
      }),
    });

    console.log('[FCM] Firebase Admin SDK initialized');
  } catch (error) {
    console.error('[FCM] Firebase init error:', error.message);
    firebaseApp = null;
  }

  return firebaseApp;
};

const getFirebase = () => firebaseApp;

module.exports = { initFirebase, getFirebase };