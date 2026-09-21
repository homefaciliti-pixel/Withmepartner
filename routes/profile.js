const express = require('express');
const router = express.Router();
const multer = require('multer');
const { users, partnerBookings, partnerTransactions, normalizeCountryCode, saveUsers, formatPhotoUrl } = require('../store/db');
const { authenticateToken } = require('../middleware/auth');
const { validateVerhoeff } = require('../utils/verhoeff');
const { encrypt, decrypt } = require('../utils/crypto');

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

const photoFields = upload.fields([
  { name: 'primary_photo', maxCount: 1 },
  { name: 'additional_photos', maxCount: 4 }
]);

// 4.1 Upload Profile Photos
router.post('/photos', authenticateToken, (req, res) => {
  photoFields(req, res, (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    const user = users.get(req.user.user_id);
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
    }

    const primary = req.files && req.files['primary_photo'] ? req.files['primary_photo'][0] : null;
    const additional = req.files && req.files['additional_photos'] ? req.files['additional_photos'] : [];

    const totalCount = (primary ? 1 : 0) + additional.length;
    if (!primary || totalCount !== 5) {
      return res.status(400).json({
        status: false,
        message: "Exactly 5 photos are required (1 primary + 4 additional)",
        error_code: "PHOTO_COUNT_INVALID"
      });
    }

    const allFiles = [primary, ...additional];
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    for (const f of allFiles) {
      if (!allowedTypes.includes(f.mimetype)) {
        return res.status(400).json({
          status: false,
          message: "Unsupported file format. Use JPG or PNG",
          error_code: "INVALID_FILE_TYPE"
        });
      }
    }

    // Process and store photo URLs
    const photoList = [
      { photo_id: "ph_001", url: `https://cdn.yourdomain.com/${user.user_id}/ph_001.jpg`, is_primary: true },
      { photo_id: "ph_002", url: `https://cdn.yourdomain.com/${user.user_id}/ph_002.jpg`, is_primary: false },
      { photo_id: "ph_003", url: `https://cdn.yourdomain.com/${user.user_id}/ph_003.jpg`, is_primary: false },
      { photo_id: "ph_004", url: `https://cdn.yourdomain.com/${user.user_id}/ph_004.jpg`, is_primary: false },
      { photo_id: "ph_005", url: `https://cdn.yourdomain.com/${user.user_id}/ph_005.jpg`, is_primary: false }
    ];

    user.photos = photoList;
    if (user.profile_step_pending === "PROFILE_PHOTO") {
      user.profile_step_pending = "AADHAR";
    }
    saveUsers();

    return res.status(201).json({
      status: true,
      message: "Profile photos uploaded successfully",
      data: { photos: user.photos }
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

// 4.3 Replace a Single Photo
router.put('/photos/:photo_id', authenticateToken, upload.single('photo'), (req, res) => {
  const { photo_id } = req.params;
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ status: false, message: "Photo file is required", error_code: "FILE_REQUIRED" });
  }

  const updatedUrl = `https://cdn.yourdomain.com/${user.user_id}/${photo_id}_v2.jpg`;
  
  if (user.photos && user.photos.length > 0) {
    const p = user.photos.find(item => item.photo_id === photo_id);
    if (p) {
      p.url = updatedUrl;
      saveUsers();
    }
  }

  return res.status(200).json({
    status: true,
    message: "Photo updated successfully",
    data: {
      photo_id,
      url: updatedUrl
    }
  });
});

const aadharFields = upload.fields([
  { name: 'aadhar_front_photo', maxCount: 1 },
  { name: 'aadhar_back_photo', maxCount: 1 }
]);

// 5.1 Submit Aadhar Details
router.post('/aadhar', authenticateToken, (req, res) => {
  aadharFields(req, res, (err) => {
    if (err) return handleUploadErrors(err, req, res, () => {});

    const { aadhar_number } = req.body;
    const user = users.get(req.user.user_id);
    if (!user) {
      return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
    }

    const front = req.files && req.files['aadhar_front_photo'] ? req.files['aadhar_front_photo'][0] : null;
    const back = req.files && req.files['aadhar_back_photo'] ? req.files['aadhar_back_photo'][0] : null;

    if (!front || !back) {
      return res.status(400).json({
        status: false,
        message: "Both front and back Aadhar images are required",
        error_code: "AADHAR_IMAGES_REQUIRED"
      });
    }

    if (!aadhar_number || !/^\d{12}$/.test(aadhar_number) || !validateVerhoeff(aadhar_number)) {
      return res.status(400).json({
        status: false,
        message: "Invalid Aadhar number format",
        error_code: "INVALID_AADHAR"
      });
    }

    // Check if Aadhar is linked to another user
    const existingUser = Array.from(users.values()).find(u => {
      if (u.user_id !== user.user_id && u.aadhar && u.aadhar.aadhar_number_encrypted) {
        const decryptedNum = decrypt(u.aadhar.aadhar_number_encrypted);
        return decryptedNum === aadhar_number;
      }
      return false;
    });

    if (existingUser) {
      return res.status(400).json({
        status: false,
        message: "Aadhar number already linked to another account",
        error_code: "AADHAR_ALREADY_EXISTS"
      });
    }

    user.aadhar = {
      aadhar_number_encrypted: encrypt(aadhar_number),
      aadhar_front_url: `https://private-bucket.s3.amazonaws.com/${user.user_id}/aadhar_front.jpg`,
      aadhar_back_url: `https://private-bucket.s3.amazonaws.com/${user.user_id}/aadhar_back.jpg`,
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
  const rawPhoto = primaryPhoto ? primaryPhoto.url : (user.profile_photo_url || `/uploads/${user.user_id}/avatar.jpg`);
  const photoUrl = formatPhotoUrl(rawPhoto, req);
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

// 8.3 Save Changes Profile API (Edit Profile: Photo, Name, Email. Phone is disabled)
router.put('/', authenticateToken, (req, res) => {
  const { profile_photo, image, name, email, mail } = req.body;
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
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

  return res.status(200).json({
    status: true,
    message: "Profile changes saved successfully",
    data: {
      image: photoUrl,
      profile_photo_url: photoUrl,
      name: user.name,
      mail: user.email,
      email: user.email,
      phone: user.mobile_number,
      country_code: cc,
      phone_disabled: true
    }
  });
});

module.exports = router;
