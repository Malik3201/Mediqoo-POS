import mongoose from 'mongoose';

async function run() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not defined in the environment variables');
  }
  
  await mongoose.connect(process.env.MONGODB_URI);
  
  if (!mongoose.connection.db) {
    throw new Error('Failed to connect to the database');
  }

  await mongoose.connection.db.collection('licenses').updateOne(
    { license_key: 'AIVRA-QTA33-K8ZSL-36VQR-9XNMN' },
    { $set: { 'features.cloud_dashboard': true } }
  );
  
  await mongoose.disconnect();
}
run().catch(console.error);
