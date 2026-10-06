const { formatPhotoUrl } = require('../store/db');

const getUserApiUrl = () => {
  return process.env.USER_APP_API_URL || process.env.WITME_USER_APP_URL || 'https://withmeapi-userapp.onrender.com';
};

/**
 * Sync a single partner user to the WithMe User App API
 */
async function syncPartnerToUserApp(partnerUser) {
  if (!partnerUser || !partnerUser.user_id) return false;

  const userAppUrls = [
    getUserApiUrl(),
    'http://localhost:5001',
    'http://localhost:5000'
  ];

  const name = partnerUser.name || 'Partner User';
  const rawPhoto = partnerUser.profile_photo_url || (partnerUser.photos && partnerUser.photos[0] ? partnerUser.photos[0].url : '/uploads/photos/photo_1.jpg');
  const photoUrl = formatPhotoUrl(rawPhoto);

  const formattedPhotos = (partnerUser.photos || []).map(p => ({
    ...p,
    url: formatPhotoUrl(p.url)
  }));

  const payload = {
    user_id: partnerUser.user_id,
    partner_id: partnerUser.user_id,
    name: name,
    full_name: name,
    email: partnerUser.email || `${String(name).toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'}@withme.app`,
    phone_number: partnerUser.mobile_number,
    mobile_number: partnerUser.mobile_number,
    gender: partnerUser.gender || 'Female',
    dob: partnerUser.dob || '2001-05-14',
    city: partnerUser.city || 'Jaipur',
    state: partnerUser.state || 'Rajasthan',
    area: partnerUser.area || 'Malviya Nagar',
    locality: partnerUser.area || 'Malviya Nagar',
    address: `${partnerUser.area || 'Malviya Nagar'}, ${partnerUser.city || 'Jaipur'}`,
    profile_image: photoUrl,
    image: photoUrl,
    profile_photo_url: photoUrl,
    photos: formattedPhotos,
    category: (partnerUser.about && partnerUser.about.interests && partnerUser.about.interests[0]) || 'Coffee',
    activity: (partnerUser.about && partnerUser.about.interests && partnerUser.about.interests[0]) || 'Coffee',
    rating: partnerUser.rating !== undefined ? partnerUser.rating : 4.8,
    total_reviews: partnerUser.total_ratings || 120,
    price: (partnerUser.availability && partnerUser.availability.pricing && partnerUser.availability.pricing[0] && partnerUser.availability.pricing[0].price) || 1,
    currency: 'INR',
    is_approved: true,
    is_verified: true,
    status: 'ACTIVE',
    profile_completed: true,
    about: partnerUser.about || { description: `Hi! I am ${name}`, interests: ["Coffee", "Travel"] },
    availability: partnerUser.availability || { availability_status: "Available", receive_requests: true },
    created_at: partnerUser.created_at || new Date().toISOString()
  };

  for (const baseUrl of userAppUrls) {
    try {
      const resp = await fetch(`${baseUrl}/api/v1/partners/register-partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        console.log(`[Cross-App Partner Sync] Successfully synced partner ${name} (${partnerUser.user_id}) to User App at ${baseUrl}`);
        return true;
      }
    } catch (err) {
      // Ignore offline host error
    }
  }
  return false;
}

/**
 * Sync all partners in array to the WithMe User App API
 */
async function syncAllPartnersToUserApp(usersArray) {
  if (!Array.isArray(usersArray) || usersArray.length === 0) return;
  console.log(`[Cross-App Partner Sync] Syncing ${usersArray.length} partners to User App...`);
  for (const u of usersArray) {
    await syncPartnerToUserApp(u).catch(err => {
      console.warn(`[Cross-App Partner Sync Warning] Failed to sync partner ${u.user_id}: ${err.message}`);
    });
  }
}

module.exports = {
  syncPartnerToUserApp,
  syncAllPartnersToUserApp
};
