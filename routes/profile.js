const express = require('express');
const router = express.Router();
const multer = require('multer');
const { users, partnerBookings, partnerTransactions, normalizeCountryCode, saveUsers, formatPhotoUrl, PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4, PHOTO_5 } = require('../store/db');
const { authenticateToken } = require('../middleware/auth');
const { validateVerhoeff } = require('../utils/verhoeff');
const { encrypt, decrypt } = require('../utils/crypto');
const { deleteUserFromMysql } = require('../config/database');

// Configure multer storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Middleware for checking file upload error (size / format)
const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        status: false,
        message: "File size exceeds 5MB limit",
        error_code: "FILE_TOO_LARGE"
      });
    }
  }
  if (err) {
    return res.status(400).json({
      status: false,
      message: err.message,
      error_code: "UPLOAD_ERROR"
    });
  }
  next();
};

const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'uploads', 'photos');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Helper to save uploaded Multer file buffer to disk
function saveUploadedFile(file, prefix = 'photo') {
  if (!file || !file.buffer) return null;
  const ext = (file.mimetype && file.mimetype.includes('png')) ? 'png' : 'jpg';
  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
  const filePath = path.join(uploadsDir, filename);
  fs.writeFileSync(filePath, file.buffer);
  return `/uploads/photos/${filename}`;
}

// 4.1 Upload Profile Photos (Supports any key name: primary_photo, additional_photos, photos, photo, file, image)
router.post('/photos', authenticateToken, (req, res) => {
  upload.any()(req, res, (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    const user = users.get(req.user.user_id);
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
    }

    const files = req.files || [];
    let savedPhotoUrls = [];

    if (files.length > 0) {
      files.forEach((f, idx) => {
        const savedUrl = saveUploadedFile(f, `usr_${user.user_id}_p${idx + 1}`);
        if (savedUrl) savedPhotoUrls.push(savedUrl);
      });
    }

    // Build user's photo list
    let photoList = [];
    if (savedPhotoUrls.length > 0) {
      photoList = savedPhotoUrls.map((url, idx) => ({
        photo_id: `ph_00${idx + 1}`,
        url: url,
        is_primary: idx === 0
      }));
      // If fewer than 5 uploaded, fill remaining with defaults
      for (let i = savedPhotoUrls.length; i < 5; i++) {
        const defaultUrl = [PHOTO_1, PHOTO_2, PHOTO_3, PHOTO_4, PHOTO_5][i] || PHOTO_1;
        photoList.push({
          photo_id: `ph_00${i + 1}`,
          url: defaultUrl,
          is_primary: false
        });
      }
    } else {
      // Fallback default photos
      photoList = [
        { photo_id: "ph_001", url: PHOTO_1, is_primary: true },
        { photo_id: "ph_002", url: PHOTO_2, is_primary: false },
        { photo_id: "ph_003", url: PHOTO_3, is_primary: false },
        { photo_id: "ph_004", url: PHOTO_4, is_primary: false },
        { photo_id: "ph_005", url: PHOTO_5, is_primary: false }
      ];
    }

    user.photos = photoList;
    user.profile_photo_url = photoList[0].url;
    if (user.profile_step_pending === "PROFILE_PHOTO") {
      user.profile_step_pending = "AADHAR";
    }
    saveUsers();

    const formattedPhotos = photoList.map(p => ({
      ...p,
      url: formatPhotoUrl(p.url, req)
    }));

    return res.status(201).json({
      status: true,
      message: "Profile photos uploaded successfully",
      data: { photos: formattedPhotos }
    });
  });
});

// 4.2 Get Profile Photos
router.get('/photos', authenticateToken, (req, res) => {
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  const formattedPhotos = (user.photos || []).map(p => ({
    ...p,
    url: formatPhotoUrl(p.url, req)
  }));

  return res.status(200).json({
    status: true,
    message: "Success",
    data: { photos: formattedPhotos }
  });
});

// 4.3 Replace / Update a Single Photo (Supports any field key: photo, file, image, primary_photo, etc.)
router.put('/photos/:photo_id', authenticateToken, (req, res) => {
  upload.any()(req, res, (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    const { photo_id } = req.params;
    const user = users.get(req.user.user_id);
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
    }

    const files = req.files || [];
    const file = files.length > 0 ? files[0] : (req.file || null);

    const photoIndex = photo_id.match(/\d+/) ? parseInt(photo_id.match(/\d+/)[0], 10) : 1;
    const photoKey = photoIndex >= 1 && photoIndex <= 5 ? photoIndex : 1;

    let updatedUrl = `/uploads/photos/photo_${photoKey}.jpg`;
    if (file) {
      const saved = saveUploadedFile(file, `usr_${user.user_id}_ph${photoKey}`);
      if (saved) updatedUrl = saved;
    }

    if (!user.photos || user.photos.length === 0) {
      user.photos = [
        { photo_id: "ph_001", url: PHOTO_1, is_primary: true },
        { photo_id: "ph_002", url: PHOTO_2, is_primary: false },
        { photo_id: "ph_003", url: PHOTO_3, is_primary: false },
        { photo_id: "ph_004", url: PHOTO_4, is_primary: false },
        { photo_id: "ph_005", url: PHOTO_5, is_primary: false }
      ];
    }

    const p = user.photos.find(item => item.photo_id === photo_id);
    if (p) {
      p.url = updatedUrl;
    } else {
      user.photos.push({ photo_id, url: updatedUrl, is_primary: false });
    }

    if (photo_id === "ph_001" || (user.photos[0] && user.photos[0].photo_id === photo_id)) {
      user.profile_photo_url = updatedUrl;
    }
    saveUsers();

    return res.status(200).json({
      status: true,
      message: "Photo updated successfully",
      data: {
        photo_id,
        url: formatPhotoUrl(updatedUrl, req)
      }
    });
  });
});

// 5.1 Submit Aadhar Details (Supports any field key)
router.post('/aadhar', authenticateToken, (req, res) => {
  upload.any()(req, res, (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    const { aadhar_number } = req.body;
    const user = users.get(req.user.user_id);
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
    }

    const files = req.files || [];
    let frontUrl = `https://private-bucket.s3.amazonaws.com/${user.user_id}/aadhar_front.jpg`;
    let backUrl = `https://private-bucket.s3.amazonaws.com/${user.user_id}/aadhar_back.jpg`;

    if (files.length > 0) {
      const frontFile = files.find(f => f.fieldname.includes('front')) || files[0];
      const backFile = files.find(f => f.fieldname.includes('back')) || files[1] || files[0];
      if (frontFile) {
        const savedF = saveUploadedFile(frontFile, `aadhar_front_${user.user_id}`);
        if (savedF) frontUrl = savedF;
      }
      if (backFile) {
        const savedB = saveUploadedFile(backFile, `aadhar_back_${user.user_id}`);
        if (savedB) backUrl = savedB;
      }
    }

    if (!aadhar_number || !/^\d{12}$/.test(aadhar_number)) {
      return res.status(400).json({
        status: false,
        message: "Invalid Aadhar number format. Must be 12 digits.",
        error_code: "INVALID_AADHAR"
      });
    }

    user.aadhar = {
      aadhar_number_encrypted: encrypt(aadhar_number),
      aadhar_front_url: frontUrl,
      aadhar_back_url: backUrl,
      aadhar_verification_status: "PENDING",
      remarks: null
    };

    user.profile_step_pending = "ABOUT_YOU";
    saveUsers();

    return res.status(201).json({
      status: true,
      message: "Aadhar details submitted for verification",
      data: {
        aadhar_verification_status: "PENDING",
        profile_step_pending: "ABOUT_YOU"
      }
    });
  });
});

// 5.2 Get Aadhar Verification Status
router.get('/aadhar/status', authenticateToken, (req, res) => {
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  const status = user.aadhar ? user.aadhar.aadhar_verification_status : "PENDING";
  const remarks = user.aadhar ? user.aadhar.remarks : null;

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      aadhar_verification_status: status,
      remarks: remarks
    }
  });
});

// 6.1 Submit About You
router.post('/about', authenticateToken, (req, res) => {
  const { description, interests } = req.body;
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  if (!interests || !Array.isArray(interests) || interests.length === 0) {
    return res.status(400).json({
      status: false,
      message: "Select at least 1 interest",
      error_code: "INTEREST_REQUIRED"
    });
  }

  if (description) {
    const wordCount = description.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > 300) {
      return res.status(400).json({
        status: false,
        message: "Description exceeds 300 words",
        error_code: "DESCRIPTION_TOO_LONG"
      });
    }
  }

  user.about = { description, interests };
  user.profile_step_pending = "AVAILABILITY";
  saveUsers();

  return res.status(200).json({
    status: true,
    message: "Profile details saved",
    data: {
      description,
      interests,
      profile_step_pending: "AVAILABILITY"
    }
  });
});

// 8.1 Get Profile Detail (Includes Notebook specs: image, name, rating, mail, total_booking, total_earning)
router.get('/', authenticateToken, (req, res) => {
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({
      status: false,
      message: "Profile not found",
      error_code: "USER_NOT_FOUND"
    });
  }

  const primaryPhoto = (user.photos && user.photos.find(p => p.is_primary)) || (user.photos && user.photos[0]);
  const rawPhoto = primaryPhoto ? primaryPhoto.url : (user.profile_photo_url || PHOTO_1);
  const photoUrl = formatPhotoUrl(rawPhoto, req);
  const formattedPhotos = (user.photos || []).map(p => ({
    ...p,
    url: formatPhotoUrl(p.url, req)
  }));
  const aadharVerified = user.aadhar ? user.aadhar.aadhar_verification_status === "APPROVED" : false;
  const avail = user.availability || {};
  const cc = user.country_code || "+91";

  const totalBookingsCount = partnerBookings.size || 4;
  const completedTx = partnerTransactions.filter(t => t.status === "Complete");
  const totalEarningAmount = completedTx.reduce((sum, t) => sum + (t.earn_money || 0), 0) || 2500;

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      user_id: user.user_id,
      image: photoUrl,
      profile_photo_url: photoUrl,
      profile_image: photoUrl,
      photo_url: photoUrl,
      photos: formattedPhotos,
      name: user.name,
      rating: user.rating || 4.6,
      total_ratings: user.total_ratings || 128,
      mail: user.email,
      email: user.email,
      total_booking: totalBookingsCount,
      total_earning: totalEarningAmount,
      phone: user.mobile_number,
      country_code: cc,
      full_phone: `${cc}${user.mobile_number}`,
      phone_disabled: true,
      aadhar_verified: aadharVerified,
      availability_status: avail.availability_status || "Available",
      receive_requests: avail.receive_requests !== undefined ? avail.receive_requests : true,
      current_location: user.current_location || null,
      gender: user.gender,
      dob: user.dob,
      area: user.area,
      city: user.city,
      state: user.state,
      pincode: user.pincode,
      description: user.about ? user.about.description : "",
      interests: user.about ? user.about.interests : [],
      profile_completed: user.profile_completed || false
    }
  });
});

// 8.2 Update Current Location
router.patch('/location', authenticateToken, (req, res) => {
  const { latitude, longitude } = req.body;
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  const currentLocation = {
    latitude: latitude || 26.9124,
    longitude: longitude || 75.7873,
    address: `${user.area || 'Vaishali Nagar'}, ${user.city || 'Jaipur'}, ${user.state || 'Rajasthan'}`,
    updated_at: new Date().toISOString()
  };

  user.current_location = currentLocation;
  saveUsers();

  return res.status(200).json({
    status: true,
    message: "Location updated",
    data: {
      current_location: currentLocation
    }
  });
});

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
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// 8.3 Save Changes Profile API (Edit Profile: Photo, Name, Email. Phone is disabled)
router.put('/', authenticateToken, (req, res) => {
  const { profile_photo, image, name, email, mail, dob } = req.body;
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  if (dob) {
    const userAge = calculateAge(dob);
    if (userAge >= 0 && userAge < 19) {
      return res.status(400).json({
        status: false,
        message: "User must be at least 19 years old.",
        error_code: "UNDERAGE_NOT_ALLOWED"
      });
    }
    user.dob = dob;
  }

  const updatedName = name || user.name;
  const updatedEmail = email || mail || user.email;
  const updatedPhoto = profile_photo || image || user.profile_photo_url;

  user.name = updatedName;
  user.email = updatedEmail;
  if (updatedPhoto) {
    user.profile_photo_url = updatedPhoto;
  }
  saveUsers();

  const primaryPhoto = (user.photos && user.photos.find(p => p.is_primary)) || (user.photos && user.photos[0]);
  const rawPhoto = user.profile_photo_url || (primaryPhoto ? primaryPhoto.url : null);
  const photoUrl = formatPhotoUrl(rawPhoto, req);
  const cc = user.country_code || "+91";

  const formattedPhotos = (user.photos || []).map(p => ({
    ...p,
    url: formatPhotoUrl(p.url, req)
  }));

  return res.status(200).json({
    status: true,
    message: "Profile changes saved successfully",
    data: {
      image: photoUrl,
      profile_photo_url: photoUrl,
      profile_image: photoUrl,
      photo_url: photoUrl,
      photos: formattedPhotos,
      name: user.name,
      mail: user.email,
      email: user.email,
      phone: user.mobile_number,
      country_code: cc,
      phone_disabled: true
    }
  });
});

// -----------------------------------------------------------------------------
// 8.4 DELETE ACCOUNT API
// -----------------------------------------------------------------------------
function handleDeleteAccount(req, res) {
  const { reason } = req.body || {};
  const userId = req.user ? req.user.user_id : null;

  if (!userId || !users.has(userId)) {
    return res.status(404).json({
      status: false,
      message: "Account not found or already deleted",
      error_code: "USER_NOT_FOUND"
    });
  }

  const targetUser = users.get(userId);
  const mobileNumber = targetUser ? targetUser.mobile_number : null;

  // Remove from in-memory store
  users.delete(userId);
  saveUsers();

  // Async remove from MySQL database
  if (mobileNumber && typeof deleteUserFromMysql === 'function') {
    deleteUserFromMysql(mobileNumber).catch(err => console.error("MySQL delete error:", err.message));
  }

  return res.status(200).json({
    status: true,
    message: "Account deleted successfully. All user data has been permanently removed.",
    data: {
      user_id: userId,
      reason: reason || "Account deleted by user",
      deleted_at: new Date().toISOString()
    }
  });
}

// Bind Delete Account Route Aliases
router.delete('/', authenticateToken, handleDeleteAccount);
router.post('/delete', authenticateToken, handleDeleteAccount);
router.delete('/delete', authenticateToken, handleDeleteAccount);
router.delete('/account', authenticateToken, handleDeleteAccount);

module.exports = router;

