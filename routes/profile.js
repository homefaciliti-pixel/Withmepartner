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
  // Always generate unique filename: prefix already contains userId, add timestamp + random for uniqueness
  const origExt = file.originalname ? path.extname(file.originalname).toLowerCase() : '';
  const ext = origExt && ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(origExt)
    ? origExt.replace('.', '')
    : (file.mimetype && file.mimetype.includes('png') ? 'png' : 'jpg');
  const unique = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const filename = `${prefix}_${unique}.${ext}`;
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, file.buffer);
  console.log(`[Upload] Saved file: ${filename}`);
  return `/uploads/photos/${filename}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo Helper Functions
// ─────────────────────────────────────────────────────────────────────────────
function saveOrCleanUrl(rawUrl, userId, slot = 1) {
  if (!rawUrl) return '';
  const str = String(rawUrl).trim();
  if (!str || str === 'null' || str === 'undefined') return '';

  // Handle base64 data URL
  if (str.startsWith('data:image')) {
    try {
      const matches = str.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
      if (matches) {
        const ext = matches[1].includes('png') ? 'png' : 'jpg';
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `usr_${userId}_ph${slot}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
        const filepath = path.join(uploadsDir, filename);
        fs.writeFileSync(filepath, buffer);
        console.log(`[Upload] Saved base64 photo for slot ${slot}: ${filename}`);
        return `/uploads/photos/${filename}`;
      }
    } catch (e) {
      console.warn('[saveOrCleanUrl base64 error]:', e.message);
    }
  }

  return str;
}

function extractPhotosFromRequest(req, user) {
  // 1. Initialize photoMap from user's current DB photos (ph_001..ph_005)
  const existingPhotos = Array.isArray(user.photos) ? user.photos : [];
  const photoMap = {};
  for (let i = 1; i <= 5; i++) {
    const pid = `ph_00${i}`;
    let existingUrl = '';
    const existingEntry = existingPhotos.find(p => p && (p.photo_id === pid || p.photo_id === `ph_${i}` || p.photo_id === String(i))) || existingPhotos[i - 1];
    if (typeof existingEntry === 'string') {
      existingUrl = existingEntry;
    } else if (existingEntry && typeof existingEntry === 'object') {
      existingUrl = existingEntry.url || existingEntry.uri || existingEntry.path || existingEntry.photo_url || existingEntry.image || '';
      if (!existingUrl && existingEntry[0] !== undefined) {
        const keys = Object.keys(existingEntry).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
        existingUrl = keys.map(k => existingEntry[k]).join('');
      }
    }
    photoMap[pid] = {
      photo_id: pid,
      url: existingUrl,
      is_primary: i === 1
    };
  }

  // 2. Process binary files from req.files (multer)
  const files = req.files || (req.file ? [req.file] : []);
  if (files.length > 0) {
    files.forEach((file, idx) => {
      const fn = String(file.fieldname || '').toLowerCase();
      let slot = null;
      const match = fn.match(/(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (fn.includes('[') && num >= 0 && num <= 4) {
          slot = num + 1; // 0-indexed photos[0] -> slot 1
        } else if (num >= 1 && num <= 5) {
          slot = num;
        }
      } else if (fn.includes('primary') || fn.includes('profile')) {
        slot = 1;
      }
      if (!slot) {
        slot = (idx + 1 <= 5) ? (idx + 1) : 1;
      }
      const pid = `ph_00${slot}`;
      const savedUrl = saveUploadedFile(file, `usr_${user.user_id}_ph${slot}`);
      if (savedUrl) {
        photoMap[pid] = { photo_id: pid, url: savedUrl, is_primary: slot === 1 };
      }
    });
  }

  // Helper to parse string or array
  const parseAnyArray = (val) => {
    if (!val) return null;
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed;
        } catch (e) {}
      } else if (trimmed.includes(',')) {
        return trimmed.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    return null;
  };

  // Helper to extract clean URL from any item (string or object)
  const getItemUrl = (item) => {
    if (!item) return '';
    if (typeof item === 'string') return item.trim();
    if (typeof item === 'object') {
      const u = item.url || item.uri || item.path || item.photo_url || item.image || item.file || item.photo || '';
      if (u) return String(u).trim();
      if (item[0] !== undefined) {
        const keys = Object.keys(item).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
        return keys.map(k => item[k]).join('').trim();
      }
    }
    return '';
  };

  // 3. Process individual photo fields in req.body
  const primaryCandidates = [
    req.body.profile_photo, req.body.image, req.body.profile_image, req.body.photo_url,
    req.body.photo_1, req.body.photo1, req.body['photos[0]'], req.body.primary_photo
  ];
  for (const c of primaryCandidates) {
    const raw = getItemUrl(c);
    if (raw && raw !== 'null' && raw !== 'undefined') {
      const clean = saveOrCleanUrl(raw, user.user_id, 1);
      if (clean) {
        photoMap['ph_001'] = { photo_id: 'ph_001', url: clean, is_primary: true };
        break;
      }
    }
  }

  for (let i = 2; i <= 5; i++) {
    const candidates = [
      req.body[`photo_${i}`], req.body[`photo${i}`],
      req.body[`photos[${i - 1}]`], req.body[`photos[${i}]`]
    ];
    for (const c of candidates) {
      const raw = getItemUrl(c);
      if (raw && raw !== 'null' && raw !== 'undefined') {
        const clean = saveOrCleanUrl(raw, user.user_id, i);
        if (clean) {
          photoMap[`ph_00${i}`] = { photo_id: `ph_00${i}`, url: clean, is_primary: false };
          break;
        }
      }
    }
  }

  // 4. Process arrays in req.body: photos, profile_images, images, profileImages, photo_gallery, gallery
  const incomingArr = parseAnyArray(req.body.photos) ||
                      parseAnyArray(req.body.profile_images) ||
                      parseAnyArray(req.body.images) ||
                      parseAnyArray(req.body.profileImages) ||
                      parseAnyArray(req.body.photo_gallery) ||
                      parseAnyArray(req.body.gallery);

  if (incomingArr && incomingArr.length > 0) {
    incomingArr.forEach((item, idx) => {
      let targetSlot = idx + 1;
      if (item && typeof item === 'object' && item.photo_id) {
        const m = String(item.photo_id).match(/(\d+)/);
        if (m) targetSlot = parseInt(m[1], 10);
      }
      if (targetSlot >= 1 && targetSlot <= 5) {
        const raw = getItemUrl(item);
        if (raw && raw !== 'null' && raw !== 'undefined') {
          const clean = saveOrCleanUrl(raw, user.user_id, targetSlot);
          if (clean) {
            photoMap[`ph_00${targetSlot}`] = {
              photo_id: `ph_00${targetSlot}`,
              url: clean,
              is_primary: targetSlot === 1
            };
          }
        }
      }
    });
  }

  // 5. Process secondary_photos array if explicitly provided
  const secArr = parseAnyArray(req.body.secondary_photos);
  if (secArr && secArr.length > 0) {
    secArr.forEach((item, idx) => {
      const slot = idx + 2;
      if (slot <= 5) {
        const raw = getItemUrl(item);
        if (raw && raw !== 'null' && raw !== 'undefined') {
          const clean = saveOrCleanUrl(raw, user.user_id, slot);
          if (clean) {
            photoMap[`ph_00${slot}`] = { photo_id: `ph_00${slot}`, url: clean, is_primary: false };
          }
        }
      }
    });
  }

  // 6. Rebuild ordered array of 5 slots
  const finalPhotos = ['ph_001', 'ph_002', 'ph_003', 'ph_004', 'ph_005'].map((pid, idx) => {
    return photoMap[pid] || { photo_id: pid, url: '', is_primary: idx === 0 };
  });

  const primaryObj = finalPhotos.find(p => p.is_primary && p.url) || finalPhotos.find(p => p.url) || finalPhotos[0];
  const primaryUrl = primaryObj && primaryObj.url ? primaryObj.url : (user.profile_photo_url || '');

  return { finalPhotos, primaryUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.1 Upload Profile Photos (All Slots / Multi-Photo)
// ─────────────────────────────────────────────────────────────────────────────
const handleUploadPhotos = async (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    try {
      const user = await findPartnerByIdFromMysql(req.user.user_id);
      if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

      const { finalPhotos, primaryUrl } = extractPhotosFromRequest(req, user);

      const newProfileStep = user.profile_step_pending === 'PROFILE_PHOTO' ? 'AADHAR' : user.profile_step_pending;
      await updatePartnerInMysql(user.user_id, {
        photos: finalPhotos,
        profile_photo_url: primaryUrl,
        profile_step_pending: newProfileStep
      });

      const updatedUser = await findPartnerByIdFromMysql(user.user_id);
      syncPartnerToUserApp(updatedUser).catch(() => {});

      const formattedPhotos = (finalPhotos || []).filter(Boolean).map((p, idx) => ({
        photo_id: (p && p.photo_id) || `ph_00${idx + 1}`,
        url: formatPhotoUrl(p ? (p.url || p.path || '') : '', req),
        is_primary: p && p.is_primary !== undefined ? Boolean(p.is_primary) : (idx === 0)
      }));

      const photoUrlsList = formattedPhotos.map(p => p.url).filter(Boolean);
      const secondaryUrls = photoUrlsList.slice(1);
      const primaryPhotoUrl = photoUrlsList[0] || formatPhotoUrl(primaryUrl, req);

      return res.status(200).json({
        status: true,
        message: 'Profile photos uploaded successfully',
        data: {
          photos: formattedPhotos,
          profile_images: photoUrlsList,
          images: photoUrlsList,
          profileImages: photoUrlsList,
          secondary_photos: secondaryUrls,
          photo_gallery: photoUrlsList,
          profile_photo_url: primaryPhotoUrl,
          image: primaryPhotoUrl,
          profile_image: primaryPhotoUrl,
          next_step: newProfileStep
        },
        photos: formattedPhotos,
        profile_images: photoUrlsList,
        images: photoUrlsList,
        profileImages: photoUrlsList,
        secondary_photos: secondaryUrls,
        photo_gallery: photoUrlsList
      });
    } catch (e) {
      console.error('[Upload Photos Error]:', e.message);
      return res.status(500).json({ status: false, message: 'Photo upload failed.', error_code: 'SERVER_ERROR' });
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// 4.2 Get Profile Photos
// ─────────────────────────────────────────────────────────────────────────────
const handleGetPhotos = async (req, res) => {
  try {
    const user = await findPartnerByIdFromMysql(req.user.user_id);
    if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

    const formattedPhotos = (user.photos || []).filter(Boolean).map((p, idx) => {
      const rawUrl = typeof p === 'string' ? p : (p ? (p.url || p.path || '') : '');
      return {
        photo_id: (p && p.photo_id) || `ph_00${idx + 1}`,
        url: formatPhotoUrl(rawUrl, req),
        is_primary: p && p.is_primary !== undefined ? Boolean(p.is_primary) : (idx === 0)
      };
    });

    const photoUrls = formattedPhotos.map(p => p.url).filter(Boolean);
    const secondaryUrls = photoUrls.slice(1);

    return res.status(200).json({
      status: true,
      message: 'Success',
      data: {
        photos: formattedPhotos,
        profile_images: photoUrls,
        images: photoUrls,
        profileImages: photoUrls,
        secondary_photos: secondaryUrls,
        photo_gallery: photoUrls
      },
      photos: formattedPhotos,
      profile_images: photoUrls,
      images: photoUrls,
      profileImages: photoUrls,
      secondary_photos: secondaryUrls,
      photo_gallery: photoUrls
    });
  } catch (err) {
    console.error('[Get Photos Error]:', err.message);
    return res.status(500).json({ status: false, message: 'Failed to fetch photos.', error_code: 'SERVER_ERROR' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4.3 Replace / Update a Single Photo (Slot 1 to 5)
// ─────────────────────────────────────────────────────────────────────────────
const handleUpdateSinglePhoto = async (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    try {
      const user = await findPartnerByIdFromMysql(req.user.user_id);
      if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

      const photoIdParam = req.params.photo_id || req.body.photo_id || req.body.slot || 'ph_001';
      const m = String(photoIdParam).match(/(\d+)/);
      const photoKey = m ? Math.min(Math.max(parseInt(m[1], 10), 1), 5) : 1;

      const files = req.files || (req.file ? [req.file] : []);
      let updatedUrl = null;

      if (files.length > 0) {
        updatedUrl = saveUploadedFile(files[0], `usr_${user.user_id}_ph${photoKey}`);
      } else {
        const raw = req.body.photo_url || req.body.url || req.body.uri || req.body.image || req.body.profile_photo || req.body.path || req.body.photo;
        if (raw) {
          updatedUrl = saveOrCleanUrl(raw, user.user_id, photoKey);
        }
      }

      if (!updatedUrl) {
        return res.status(400).json({ status: false, message: 'No photo file or URL provided.', error_code: 'NO_PHOTO_PROVIDED' });
      }

      // Rebuild 5 slots preserving existing photos
      const { finalPhotos } = extractPhotosFromRequest({ body: {}, files: [] }, user);
      finalPhotos[photoKey - 1] = {
        photo_id: `ph_00${photoKey}`,
        url: updatedUrl,
        is_primary: photoKey === 1
      };

      const updateFields = { photos: finalPhotos };
      if (photoKey === 1) {
        updateFields.profile_photo_url = updatedUrl;
      }

      await updatePartnerInMysql(user.user_id, updateFields);
      const updatedUser = await findPartnerByIdFromMysql(user.user_id);
      syncPartnerToUserApp(updatedUser).catch(() => {});

      const formattedPhotos = (updatedUser.photos || []).filter(Boolean).map((p, idx) => ({
        photo_id: (p && p.photo_id) || `ph_00${idx + 1}`,
        url: formatPhotoUrl(p ? (p.url || p.path || '') : '', req),
        is_primary: p && p.is_primary !== undefined ? Boolean(p.is_primary) : (idx === 0)
      }));

      const photoUrlsList = formattedPhotos.map(p => p.url).filter(Boolean);
      const secondaryUrls = photoUrlsList.slice(1);

      return res.status(200).json({
        status: true,
        message: 'Photo updated successfully',
        data: {
          photo_id: `ph_00${photoKey}`,
          url: formatPhotoUrl(updatedUrl, req),
          profile_photo_url: formatPhotoUrl(updatedUser.profile_photo_url, req),
          photos: formattedPhotos,
          profile_images: photoUrlsList,
          images: photoUrlsList,
          profileImages: photoUrlsList,
          secondary_photos: secondaryUrls,
          photo_gallery: photoUrlsList
        },
        photos: formattedPhotos,
        profile_images: photoUrlsList,
        images: photoUrlsList,
        profileImages: photoUrlsList,
        secondary_photos: secondaryUrls,
        photo_gallery: photoUrlsList
      });
    } catch (e) {
      console.error('[Update Single Photo Error]:', e.message);
      return res.status(500).json({ status: false, message: 'Failed to update photo.', error_code: 'SERVER_ERROR' });
    }
  });
};

router.post('/photos', authenticateToken, handleUploadPhotos);
router.put('/photos', authenticateToken, handleUploadPhotos);
router.get('/photos', authenticateToken, handleGetPhotos);

router.put('/photos/:photo_id', authenticateToken, handleUpdateSinglePhoto);
router.post('/photos/:photo_id', authenticateToken, handleUpdateSinglePhoto);
router.patch('/photos/:photo_id', authenticateToken, handleUpdateSinglePhoto);

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
    const photoUrlsList = formattedPhotos.map(p => p.url).filter(Boolean);
    const secondaryPhotos = photoUrlsList.slice(1);
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
        profile_images: photoUrlsList,
        images: photoUrlsList,
        profileImages: photoUrlsList,
        secondary_photos: secondaryPhotos,
        photo_gallery: photoUrlsList,
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
// 8.3 Save Changes Profile (Edit: Photos, Name, Email, DOB)
// ─────────────────────────────────────────────────────────────────────────────
const handleSaveProfileAndPhotos = async (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    try {
      const user = await findPartnerByIdFromMysql(req.user.user_id);
      if (!user) return res.status(404).json({ status: false, message: 'User not found', error_code: 'USER_NOT_FOUND' });

      const { name, email, mail, dob } = req.body;
      if (dob) {
        const userAge = calculateAge(dob);
        if (userAge >= 0 && userAge < 19) {
          return res.status(400).json({ status: false, message: 'User must be at least 19 years old.', error_code: 'UNDERAGE_NOT_ALLOWED' });
        }
      }

      const updatedName = name || user.name;
      const updatedEmail = email || mail || user.email;

      const updateFields = { name: updatedName, email: updatedEmail };
      if (dob) updateFields.dob = dob;

      const { finalPhotos, primaryUrl } = extractPhotosFromRequest(req, user);

      // Check if any photo was provided or uploaded
      const hasAnyPhotoInput = (req.files && req.files.length > 0) ||
                               req.body.photos || req.body.profile_images || req.body.images ||
                               req.body.profileImages || req.body.secondary_photos || req.body.photo_gallery ||
                               req.body.gallery || req.body.profile_photo || req.body.image || req.body.profile_image ||
                               req.body.photo_1 || req.body.photo1 || req.body.photo_2 || req.body.photo2 ||
                               req.body.photo_3 || req.body.photo3 || req.body.photo_4 || req.body.photo4 ||
                               req.body.photo_5 || req.body.photo5 || req.body['photos[0]'];

      if (hasAnyPhotoInput) {
        updateFields.photos = finalPhotos;
        if (primaryUrl) {
          updateFields.profile_photo_url = primaryUrl;
        }
      }

      await updatePartnerInMysql(user.user_id, updateFields);

      const updatedUser = await findPartnerByIdFromMysql(user.user_id);
      syncPartnerToUserApp(updatedUser).catch(() => {});

      const primaryPhoto = (updatedUser.photos && updatedUser.photos.find(p => p.is_primary)) || (updatedUser.photos && updatedUser.photos[0]);
      const rawPhoto = updatedUser.profile_photo_url || (primaryPhoto ? primaryPhoto.url : null);
      const photoUrl = formatPhotoUrl(rawPhoto, req);
      const cc = updatedUser.country_code || '+91';
      const formattedPhotos = (updatedUser.photos || []).map(p => ({
        photo_id: (p && p.photo_id) || 'ph_001',
        url: formatPhotoUrl(p ? (p.url || p.path || '') : '', req),
        is_primary: p && p.is_primary !== undefined ? Boolean(p.is_primary) : false
      }));
      const photoUrlsList = formattedPhotos.map(p => p.url).filter(Boolean);
      const secondaryPhotos = photoUrlsList.slice(1);

      return res.status(200).json({
        status: true,
        message: 'Profile changes saved successfully',
        data: {
          image: photoUrl,
          profile_photo_url: photoUrl,
          profile_image: photoUrl,
          photo_url: photoUrl,
          photos: formattedPhotos,
          profile_images: photoUrlsList,
          images: photoUrlsList,
          profileImages: photoUrlsList,
          secondary_photos: secondaryPhotos,
          photo_gallery: photoUrlsList,
          name: updatedUser.name,
          mail: updatedUser.email,
          email: updatedUser.email,
          phone: updatedUser.mobile_number,
          country_code: cc,
          phone_disabled: true
        },
        photos: formattedPhotos,
        profile_images: photoUrlsList,
        images: photoUrlsList,
        profileImages: photoUrlsList,
        secondary_photos: secondaryPhotos,
        photo_gallery: photoUrlsList
      });
    } catch (err) {
      console.error('[Profile Update Error]:', err.message);
      return res.status(500).json({ status: false, message: 'Failed to update profile.', error_code: 'SERVER_ERROR' });
    }
  });
};

router.put('/', authenticateToken, handleSaveProfileAndPhotos);
router.post('/', authenticateToken, handleSaveProfileAndPhotos);
router.patch('/', authenticateToken, handleSaveProfileAndPhotos);
router.put('/edit', authenticateToken, handleSaveProfileAndPhotos);
router.post('/edit', authenticateToken, handleSaveProfileAndPhotos);

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
module.exports.handleUploadPhotos = handleUploadPhotos;
module.exports.handleGetPhotos = handleGetPhotos;
module.exports.handleUpdateSinglePhoto = handleUpdateSinglePhoto;
module.exports.handleSaveProfileAndPhotos = handleSaveProfileAndPhotos;

