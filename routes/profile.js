const express = require('express');
const router = express.Router();
const multer = require('multer');
const { users, otpSessions, normalizeCountryCode } = require('../store/db');
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

  return res.status(200).json({
    status: true,
    message: "Success",
    data: { photos: user.photos || [] }
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

// 8.1 Get Profile Detail
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
  const aadharVerified = user.aadhar ? user.aadhar.aadhar_verification_status === "APPROVED" : false;
  const avail = user.availability || {};
  const cc = user.country_code || "+91";

  return res.status(200).json({
    status: true,
    message: "Success",
    data: {
      user_id: user.user_id,
      name: user.name,
      profile_photo_url: primaryPhoto ? primaryPhoto.url : null,
      rating: user.rating || 0.0,
      total_ratings: user.total_ratings || 0,
      aadhar_verified: aadharVerified,
      availability_status: avail.availability_status || "Unavailable",
      receive_requests: avail.receive_requests !== undefined ? avail.receive_requests : true,
      current_location: user.current_location || null,
      email: user.email,
      country_code: cc,
      phone: user.mobile_number,
      full_phone: `${cc}${user.mobile_number}`,
      phone_verified: user.phone_verified !== undefined ? user.phone_verified : true,
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

  return res.status(200).json({
    status: true,
    message: "Location updated",
    data: {
      current_location: currentLocation
    }
  });
});

// 8.3 Edit Profile
router.put('/', authenticateToken, (req, res) => {
  const { name, email, phone, country_code } = req.body;
  const user = users.get(req.user.user_id);
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found", error_code: "USER_NOT_FOUND" });
  }

  if (name) user.name = name;
  if (email) user.email = email;

  const newCC = country_code ? normalizeCountryCode(country_code) : (user.country_code || "+91");

  // Check if phone number or country code is changed
  if ((phone && phone !== user.mobile_number) || (country_code && newCC !== user.country_code)) {
    const targetPhone = phone || user.mobile_number;
    const otp_session_id = `otp_sess_${Math.random().toString(36).substring(2, 8)}`;
    
    otpSessions.set(otp_session_id, {
      country_code: newCC,
      mobile_number: targetPhone,
      otp: "1234",
      type: "phone_change",
      user_id: user.user_id,
      expires_at: Date.now() + 5 * 60 * 1000
    });

    user.pending_phone_change = targetPhone;
    user.pending_country_code_change = newCC;
    user.phone_verified = false;

    return res.status(200).json({
      status: true,
      message: "OTP sent to new phone number for verification",
      data: {
        otp_session_id,
        otp_expires_in: 300,
        phone_verified: false,
        country_code: newCC,
        pending_phone_change: targetPhone
      }
    });
  }

  return res.status(200).json({
    status: true,
    message: "Profile updated successfully",
    data: {
      name: user.name,
      email: user.email,
      country_code: user.country_code || "+91",
      phone: user.mobile_number,
      phone_verified: user.phone_verified !== undefined ? user.phone_verified : true
    }
  });
});

module.exports = router;
