import mongoose from 'mongoose';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.db.collection('licenses').updateOne(
    { license_key: 'AIVRA-QTA33-K8ZSL-36VQR-9XNMN' },
    { $set: { 'features.cloud_dashboard': true } }
  );
  await mongoose.disconnect();
}
run().catch(console.error);
