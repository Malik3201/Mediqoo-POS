require('dotenv').config({ path: '.env.local' });
const mongoose = require('mongoose');

async function getTestData() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const License = mongoose.model('License', new mongoose.Schema({}, { strict: false }));
  const LicenseSeat = mongoose.model('LicenseSeat', new mongoose.Schema({}, { strict: false }));
  
  const license = await License.findOne({ status: 'active' });
  if (license) {
    const seat = await LicenseSeat.findOne({ license_id: license.id });
    if (seat) {
      console.log('ACTIVE LICENSE KEY:', license.license_key);
      console.log('MACHINE ID:', seat.machine_id);
    } else {
      console.log('No seat for active license');
    }
  } else {
    console.log('No active license found');
  }

  mongoose.disconnect();
}
getTestData();
