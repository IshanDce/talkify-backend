/**
 * One-off script: Delete users by phone number from MongoDB.
 * 
 * Usage: node scripts/delete_users.js
 * 
 * Numbers to delete: 8076574242, 9654133689, 9312121655
 * (stored as +918076574242, +919654133689, +919312121655)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const User = require('../src/models/User');
const Chat = require('../src/models/Chat');
const Message = require('../src/models/Message');
const CallLog = require('../src/models/CallLog');

// Normalize phone numbers the same way the app does (E.164)
const normalizePhone = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 10 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return `+${digits}`;
};

const phonesToDelete = ['8076574242', '9654133689', '9312121655'];
const normalizedPhones = phonesToDelete.map(normalizePhone);

console.log('=== Talkify User Deletion Script ===');
console.log(`Input numbers : ${phonesToDelete.join(', ')}`);
console.log(`Normalized    : ${normalizedPhones.join(', ')}`);
console.log('');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/talkify';
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(uri);
  console.log(`Connected to: ${mongoose.connection.host}\n`);

  // Step 1: Find the users
  const users = await User.find({ phone: { $in: normalizedPhones } }).lean();
  
  if (users.length === 0) {
    console.log('No users found with these phone numbers. They may already be deleted.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Found ${users.length} user(s) to delete:`);
  const userIds = [];
  for (const u of users) {
    console.log(`  - ${u.phone} (name: "${u.name || '(no name)'}", _id: ${u._id})`);
    userIds.push(u._id);
  }

  console.log('\n--- Performing cleanup ---');

  // Step 2: Delete associated messages
  const msgResult = await Message.deleteMany({ senderId: { $in: userIds } });
  console.log(`Deleted ${msgResult.deletedCount} message(s) sent by these users.`);

  // Step 3: Delete call logs involving these users
  const callResult = await CallLog.deleteMany({
    $or: [
      { callerId: { $in: userIds } },
      { calleeId: { $in: userIds } },
    ],
  });
  console.log(`Deleted ${callResult.deletedCount} call log(s) involving these users.`);

  // Step 4: Remove these users from chat participants
  // For direct (non-group) chats, remove the whole chat if a participant is deleted
  // For group chats, just remove the user from participants
  const directChats = await Chat.find({
    isGroup: false,
    participants: { $in: userIds },
  }).lean();
  
  const directChatIds = directChats.map(c => c._id);
  if (directChatIds.length > 0) {
    const directMsgDel = await Message.deleteMany({ chatId: { $in: directChatIds } });
    console.log(`Deleted ${directMsgDel.deletedCount} message(s) from ${directChatIds.length} direct chat(s).`);
    const directChatDel = await Chat.deleteMany({ _id: { $in: directChatIds } });
    console.log(`Deleted ${directChatDel.deletedCount} direct chat(s).`);
  } else {
    console.log('No direct chats to clean up.');
  }

  // Remove users from group chat participants
  const groupUpdate = await Chat.updateMany(
    { isGroup: true, participants: { $in: userIds } },
    { $pull: { participants: { $in: userIds } } }
  );
  console.log(`Removed users from ${groupUpdate.modifiedCount} group chat(s).`);

  // Step 5: Delete the user documents themselves
  const userResult = await User.deleteMany({ _id: { $in: userIds } });
  console.log(`\nDeleted ${userResult.deletedCount} user document(s).`);

  console.log('\n=== Cleanup complete ===');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});