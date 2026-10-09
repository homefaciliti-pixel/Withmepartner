const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  normalizeCountryCode,
  formatPhotoUrl,
  PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4, PHOTO_5
} = require('../store/db');
const { authenticateToken } = require('../middleware/auth');
const { validateVerhoeff } = require('../utils/verhoeff');
const { encrypt } = require('../utils/crypto');
const {
  deleteUserFromMysql,
  updatePartnerInMysql,
  findPartnerByIdFromMysql,
  fetchPartnerBookingsFromMysql,
  fetchPartnerTransactionsFromMysql
} = require('../config/database');
const { syncPartnerToUserApp } = require('../services/userAppSyncService');

// ─────────────────────────────────────────────────────────────────────────────
// Multer setup
// ─────────────────────────────────────────────────────────────────────────────
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ status: false, message: 'File size exceeds 5MB limit', error_code: 'FILE_TOO_LARGE' });
    }
  }
  if (err) return res.status(400).json({ status: false, message: err.message, error_code: 'UPLOAD_ERROR' });
  next();
};

const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'uploads', 'photos');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

function saveUploadedFile(file, prefix = 'photo') {
  if (!file || !file.buffer) return null;
  const ext = (file.mimetype && file.mimetype.includes('png')) ? 'png' : 'jpg';
  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, file.buffer);
  return `/uploads/photos/${filename}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.1 Upload Profile Photos
// ─────────────────────────────────────────────────────────────────────────────
router.post('/photos', authenticateToken, (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    try {
      const user = await findPartnerByIdFromMysql(req.user.user_id);
      if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

      const files = req.files || [];
      let savedPhotoUrls = [];

      if (files.length > 0) {
        files.forEach((f, idx) => {
          const savedUrl = saveUploadedFile(f, `usr_${user.user_id}_p${idx + 1}`);
          if (savedUrl) savedPhotoUrls.push(savedUrl);
        });
      }

      let photoList = [];
      if (savedPhotoUrls.length > 0) {
        photoList = savedPhotoUrls.map((url, idx) => ({
          photo_id: `ph_00${idx + 1}`,
          url,
          is_primary: idx === 0
        }));
        for (let i = savedPhotoUrls.length; i < 5; i++) {
          const defaultUrl = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4, PHOTO_5][i] || PHOTO_1;
          photoList.push({ photo_id: `ph_00${i + 1}`, url: defaultUrl, is_primary: false });
        }
      } else {
        photoList = [
          { photo_id: 'ph_001', url: PHOTO_1, is_primary: true },
          { photo_id: 'ph_002', url: PHOTO_2, is_primary: false },
          { photo_id: 'ph_003', url: PHOTO_3, is_primary: false },
          { photo_id: 'ph_004', url: PHOTO_4, is_primary: false },
          { photo_id: 'ph_005', url: PHOTO_5, is_primary: false }
        ];
      }

      const newProfileStep = user.profile_step_pending === 'PROFILE_PHOTO' ? 'AADHAR' : user.profile_step_pending;
      await updatePartnerInMysql(user.user_id, {
        photos: photoList,
        profile_photo_url: photoList[0].url,
        profile_step_pending: newProfileStep
      });

      const updatedUser = await findPartnerByIdFromMysql(user.user_id);
      syncPartnerToUserApp(updatedUser).catch(() => {});

      const formattedPhotos = photoList.map(p => ({ ...p, url: formatPhotoUrl(p.url, req) }));

      return res.status(201).json({
        status: true,
        message: 'Profile photos uploaded successfully',
        data: { photos: formattedPhotos }
      });
    } catch (e) {
      console.error('[Photo Upload Error]:', e.message);
      return res.status(500).json({ status: false, message: 'Photo upload failed.', error_code: 'SERVER_ERROR' });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.2 Get Profile Photos
// ─────────────────────────────────────────────────────────────────────────────
router.get('/photos', authenticateToken, async (req, res) => {
  try {
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    const formattedPhotos = (user.photos || []).map(p => ({ ...p, url: formatPhotoUrl(p.url, req) }));

    return res.status(200).json({ status: true, message: 'Success', data: { photos: formattedPhotos } });
  } catch (err) {
    console.error('[Get Photos Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch photos.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.3 Replace / Update a Single Photo
// ─────────────────────────────────────────────────────────────────────────────
router.put('/photos/:photo_id', authenticateToken, (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    try {
      const { photo_id } = req.params;
      const user = await findPartnerByIdFromMysql(req.user.user_id);
      if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

      const files = req.files || [];
      const file = files.length > 0 ? files[0] : (req.file || null);
      const photoIndex = photo_id.match(/\d+/) ? parseInt(photo_id.match(/\d+/)[0], 10) : 1;
      const photoKey = photoIndex >= 1 && photoIndex <= 5 ? photoIndex : 1;

      let updatedUrl = null;
      if (file) {
        updatedUrl = saveUploadedFile(file, `usr_${user.user_id}_ph${photoKey}`);
      } else if (req.body && (req.body.photo_url || req.body.url || req.body.image || req.body.profile_photo)) {
        const inputUrl = req.body.photo_url || req.body.url || req.body.image || req.body.profile_photo;
        if (inputUrl.startsWith('data:image')) {
          // Handle base64 upload
          const matches = inputUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1].includes('png') ? 'png' : 'jpg';
            const buffer = Buffer.from(matches[2], 'base64');
            const filename = `usr_${user.user_id}_ph${photoKey}_${Date.now()}.${ext}`;
            const filepath = path.join(uploadsDir, filename);
            fs.writeFileSync(filepath, buffer);
            updatedUrl = `/uploads/photos/${filename}`;
          }
        } else {
          updatedUrl = inputUrl;
        }
      }

      if (!updatedUrl) {
        updatedUrl = `/uploads/photos/photo_${photoKey}.jpg`;
      }

      let photos = Array.isArray(user.photos) ? user.photos : [
        { photo_id: 'ph_001', url: PHOTO_1, is_primary: true },
        { photo_id: 'ph_002', url: PHOTO_2, is_primary: false },
        { photo_id: 'ph_003', url: PHOTO_3, is_primary: false },
        { photo_id: 'ph_004', url: PHOTO_4, is_primary: false },
        { photo_id: 'ph_005', url: PHOTO_5, is_primary: false }
      ];

      // Standardize photo array elements
      photos = photos.map((item, idx) => {
        if (typeof item === 'string') return { photo_id: `ph_00${idx + 1}`, url: item, is_primary: idx === 0 };
        return { photo_id: item.photo_id || `ph_00${idx + 1}`, url: item.url || item.path || '', is_primary: Boolean(item.is_primary) };
      });

      const targetIdClean = photo_id.toLowerCase().trim();
      const pIndex = photos.findIndex(item => item.photo_id.toLowerCase() === targetIdClean || item.photo_id.endsWith(String(photoKey)));
      if (pIndex !== -1) {
        photos[pIndex].url = updatedUrl;
      } else {
        photos.push({ photo_id: `ph_00${photoKey}`, url: updatedUrl, is_primary: photoKey === 1 });
      }

      const updateFields = { photos };
      if (photoKey === 1 || targetIdClean === 'ph_001' || pIndex === 0) {
        updateFields.profile_photo_url = updatedUrl;
      }

      await updatePartnerInMysql(user.user_id, updateFields);

      const updatedUser = await findPartnerByIdFromMysql(user.user_id);
      syncPartnerToUserApp(updatedUser).catch(() => {});

      const formattedPhotos = (updatedUser.photos || []).map(p => ({ ...p, url: formatPhotoUrl(p.url, req) }));

      return res.status(200).json({
        status: true,
        message: 'Photo updated successfully',
        data: {
          photo_id: `ph_00${photoKey}`,
          url: formatPhotoUrl(updatedUrl, req),
          profile_photo_url: formatPhotoUrl(updatedUser.profile_photo_url, req),
          photos: formattedPhotos
        }
      });
    } catch (e) {
      console.error('[Update Photo Error]:', e.message);
      return res.status(500).json({ status: false, message: 'Failed to update photo.', error_code: 'SERVER_ERROR' });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.1 Submit Aadhar Details
// ─────────────────────────────────────────────────────────────────────────────
router.post('/aadhar', authenticateToken, (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    try {
      const { aadhar_number } = req.body;
      const user = await findPartnerByIdFromMysql(req.user.user_id);
      if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

      const files = req.files || [];
      let frontUrl = `https://private-bucket.s3.amazonaws.com/${user.user_id}/aadhar_front.jpg`;
      let backUrl = `https://private-bucket.s3.amazonaws.com/${user.user_id}/aadhar_back.jpg`;

      if (files.length > 0) {
        const frontFile = files.find(f => f.fieldname.includes('front')) || files[0];
        const backFile = files.find(f => f.fieldname.includes('back')) || files[1] || files[0];
        if (frontFile) { const s = saveUploadedFile(frontFile, `aadhar_front_${user.user_id}`); if (s) frontUrl = s; }
        if (backFile) { const s = saveUploadedFile(backFile, `aadhar_back_${user.user_id}`); if (s) backUrl = s; }
      }

      if (!aadhar_number || !/^\d{12}$/.test(aadhar_number)) {
        return res.status(400).json({ status: false, message: 'Invalid Aadhar number format. Must be 12 digits.', error_code: 'INVALID_AADHAR' });
      }

      await updatePartnerInMysql(user.user_id, {
        aadhar: {
          aadhar_number: encrypt(aadhar_number),
          aadhar_front_url: frontUrl,
          aadhar_back_url: backUrl
        },
        profile_step_pending: 'ABOUT_YOU'
      });

      return res.status(201).json({
        status: true,
        message: 'Aadhar details submitted for verification',
        data: { aadhar_verification_status: 'PENDING', profile_step_pending: 'ABOUT_YOU' }
      });
    } catch (e) {
      console.error('[Aadhar Submit Error]:', e.message);
      return res.status(500).json({ status: false, message: 'Failed to submit Aadhar details.', error_code: 'SERVER_ERROR' });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.2 Get Aadhar Verification Status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/aadhar/status', authenticateToken, async (req, res) => {
  try {
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    const status = user.aadhar ? (user.aadhar.aadhar_verification_status || 'PENDING') : 'PENDING';
    const remarks = user.aadhar ? user.aadhar.remarks : null;

    return res.status(200).json({ status: true, message: 'Success', data: { aadhar_verification_status: status, remarks } });
  } catch (err) {
    console.error('[Aadhar Status Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch Aadhar status.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6.1 Submit About You
// ─────────────────────────────────────────────────────────────────────────────
router.post('/about', authenticateToken, async (req, res) => {
  try {
    const { description, interests } = req.body;
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    if (!interests || !Array.isArray(interests) || interests.length === 0) {
      return res.status(400).json({ status: false, message: 'Select at least 1 interest', error_code: 'INTEREST_REQUIRED' });
    }

    if (description) {
      const wordCount = description.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount > 300) {
        return res.status(400).json({ status: false, message: 'Description exceeds 300 words', error_code: 'DESCRIPTION_TOO_LONG' });
      }
    }

    await updatePartnerInMysql(user.user_id, {
      about: { description, interests },
      interests: interests,
      profile_step_pending: 'AVAILABILITY'
    });

    return res.status(200).json({
      status: true,
      message: 'Profile details saved',
      data: { description, interests, profile_step_pending: 'AVAILABILITY' }
    });
  } catch (err) {
    console.error('[About Submit Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to save about details.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8.1 Get Profile Detail
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) {
      return res.status(404).json({ status: false, message: 'Profile not found', error_code: 'USER_NOT_FOUND' });
    }

    const primaryPhoto = (user.photos && user.photos.find(p => p.is_primary)) || (user.photos && user.photos[0]);
    const rawPhoto = primaryPhoto ? primaryPhoto.url : (user.profile_photo_url || '');
    const photoUrl = rawPhoto ? formatPhotoUrl(rawPhoto, req) : '';
    const formattedPhotos = (user.photos || []).map((p, idx) => {
      let rawUrl = '';
      let pId = `ph_00${idx + 1}`;
      let isPrimary = idx === 0;

      if (typeof p === 'string') {
        rawUrl = p;
      } else if (p && typeof p === 'object') {
        rawUrl = p.url || p.path || '';
        if (p.photo_id) pId = p.photo_id;
        if (p.is_primary !== undefined) isPrimary = Boolean(p.is_primary);

        // Check if object has numeric index keys (e.g. { "0": "h", "1": "t", ... })
        if (!rawUrl && p[0] !== undefined) {
          const keys = Object.keys(p).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
          rawUrl = keys.map(k => p[k]).join('');
        }
      }

      return {
        photo_id: pId,
        url: formatPhotoUrl(rawUrl, req),
        is_primary: isPrimary
      };
    });
    const aadharVerified = user.aadhar ? (user.aadhar.aadhar_verification_status === 'APPROVED') : false;
    const avail = user.availability || {};
    const cc = user.country_code || '+91';

    // Fetch booking/earning counts from MySQL
    const myBookings = await fetchPartnerBookingsFromMysql(user.user_id);
    const totalBookingsCount = myBookings.length;

    const myTx = await fetchPartnerTransactionsFromMysql(user.user_id);
    const totalEarningAmount = myTx.filter(t => t.status === 'Complete').reduce((sum, t) => sum + (t.earn_money || 0), 0);

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: {
        user_id: user.user_id,
        image: photoUrl,
        profile_photo_url: photoUrl,
        profile_image: photoUrl,
        photo_url: photoUrl,
        photos: formattedPhotos,
        name: user.name,
        rating: user.rating !== undefined ? user.rating : 0.0,
        total_ratings: user.total_ratings || 0,
        mail: user.email,
        email: user.email,
        total_booking: totalBookingsCount,
        total_earning: totalEarningAmount,
        phone: user.mobile_number,
        country_code: cc,
        full_phone: `${cc}${user.mobile_number}`,
        phone_disabled: true,
        aadhar_verified: aadharVerified,
        availability_status: avail.availability_status || 'Available',
        receive_requests: avail.receive_requests !== undefined ? avail.receive_requests : true,
        current_location: user.current_location || null,
        gender: user.gender,
        dob: user.dob,
        area: user.area,
        city: user.city,
        state: user.state,
        pincode: user.pincode,
        description: user.about ? user.about.description : '',
        interests: user.about ? user.about.interests : [],
        profile_completed: user.profile_completed || false
      }
    });
  } catch (err) {
    console.error('[Get Profile Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch profile.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8.2 Update Current Location
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/location', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    await updatePartnerInMysql(user.user_id, {
      latitude: latitude || 26.9124,
      longitude: longitude || 75.7873,
      address: `${user.area || 'Vaishali Nagar'}, ${user.city || 'Jaipur'}, ${user.state || 'Rajasthan'}`
    });

    const currentLocation = {
      latitude: latitude || 26.9124,
      longitude: longitude || 75.7873,
      address: `${user.area || 'Vaishali Nagar'}, ${user.city || 'Jaipur'}, ${user.state || 'Rajasthan'}`,
      updated_at: new Date().toISOString()
    };

    return res.status(200).json({ status: true, message: 'Location updated', data: { current_location: currentLocation } });
  } catch (err) {
    console.error('[Location Update Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to update location.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Age helper
// ─────────────────────────────────────────────────────────────────────────────
function calculateAge(dobStr) {
  if (!dobStr) return -1;
  let birthDate;
  const str = String(dobStr).trim();
  if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(str)) {
    const parts = str.split(/[-\/]/);
    birthDate = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  } else {
    birthDate = new Date(str);
  }
  if (isNaN(birthDate.getTime())) return -1;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8.3 Save Changes Profile (Edit: Photo, Name, Email — Phone disabled)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/', authenticateToken, async (req, res) => {
  try {
    const { profile_photo, image, name, email, mail, dob } = req.body;
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    if (dob) {
      const userAge = calculateAge(dob);
      if (userAge >= 0 && userAge < 19) {
        return res.status(400).json({ status: false, message: 'User must be at least 19 years old.', error_code: 'UNDERAGE_NOT_ALLOWED' });
      }
    }

    const updatedName = name || user.name;
    const updatedEmail = email || mail || user.email;
    const updatedPhoto = profile_photo || image || user.profile_photo_url;
    const incomingPhotos = req.body.photos;

    const updateFields = { name: updatedName, email: updatedEmail };
    if (dob) updateFields.dob = dob;
    if (updatedPhoto) {
      updateFields.profile_photo_url = updatedPhoto;
      let photos = Array.isArray(user.photos) ? user.photos : [];
      if (photos.length > 0) {
        if (typeof photos[0] === 'object') photos[0].url = updatedPhoto;
        else photos[0] = { photo_id: 'ph_001', url: updatedPhoto, is_primary: true };
      } else {
        photos = [{ photo_id: 'ph_001', url: updatedPhoto, is_primary: true }];
      }
      updateFields.photos = photos;
    }
    if (Array.isArray(incomingPhotos) && incomingPhotos.length > 0) {
      updateFields.photos = incomingPhotos;
    }

    await updatePartnerInMysql(user.user_id, updateFields);

    const updatedUser = await findPartnerByIdFromMysql(user.user_id);
    syncPartnerToUserApp(updatedUser).catch(() => {});

    const primaryPhoto = (updatedUser.photos && updatedUser.photos.find(p => p.is_primary)) || (updatedUser.photos && updatedUser.photos[0]);
    const rawPhoto = updatedUser.profile_photo_url || (primaryPhoto ? primaryPhoto.url : null);
    const photoUrl = formatPhotoUrl(rawPhoto, req);
    const cc = updatedUser.country_code || '+91';
    const formattedPhotos = (updatedUser.photos || []).map(p => ({ ...p, url: formatPhotoUrl(p.url, req) }));

    return res.status(200).json({
      status: true,
      message: 'Profile changes saved successfully',
      data: {
        image: photoUrl,
        profile_photo_url: photoUrl,
        profile_image: photoUrl,
        photo_url: photoUrl,
        photos: formattedPhotos,
        name: updatedUser.name,
        mail: updatedUser.email,
        email: updatedUser.email,
        phone: updatedUser.mobile_number,
        country_code: cc,
        phone_disabled: true
      }
    });
  } catch (err) {
    console.error('[Profile Update Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to update profile.', error_code: 'SERVER_ERROR' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8.4 Delete Account
// ─────────────────────────────────────────────────────────────────────────────
async function handleDeleteAccount(req, res) {
  const reason = (req.query && (req.query.reason || req.query.delete_reason)) || (req.body && (req.body.reason || req.body.delete_reason)) || 'Account deleted by user';
  const userId = (req.user && req.user.user_id) || (req.query && (req.query.user_id || req.query.id)) || (req.body && (req.body.user_id || req.body.id)) || null;

  try {
    let mobileNumber = (req.query && (req.query.mobile_number || req.query.phone)) || (req.body && (req.body.mobile_number || req.body.phone)) || null;

    if (userId) {
      const targetUser = await findPartnerByIdFromMysql(userId);
      if (targetUser && targetUser.mobile_number) mobileNumber = targetUser.mobile_number;
    }

    if (mobileNumber) {
      await deleteUserFromMysql(mobileNumber);
    }

    return res.status(200).json({
      status: true,
      message: 'Account deleted successfully. All user data has been permanently removed.',
      data: { user_id: userId, reason, deleted_at: new Date().toISOString() }
    });
  } catch (err) {
    console.error('[Delete Account Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to delete account.', error_code: 'SERVER_ERROR' });
  }
}

router.delete('/', authenticateToken, handleDeleteAccount);
router.get('/delete-account', authenticateToken, handleDeleteAccount);
router.post('/delete-account', authenticateToken, handleDeleteAccount);
router.delete('/delete-account', authenticateToken, handleDeleteAccount);
router.get('/delete', authenticateToken, handleDeleteAccount);
router.post('/delete', authenticateToken, handleDeleteAccount);
router.delete('/delete', authenticateToken, handleDeleteAccount);
router.get('/account', authenticateToken, handleDeleteAccount);
router.post('/account', authenticateToken, handleDeleteAccount);
router.delete('/account', authenticateToken, handleDeleteAccount);

module.exports = router;
