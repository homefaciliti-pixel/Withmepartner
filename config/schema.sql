-- =============================================================================
-- Standalone MySQL Database Schema for WithMe Partner App API & User App Integration
-- Database Name: withme_partner_db (or custom DB name configured in .env)
-- =============================================================================

CREATE DATABASE IF NOT EXISTS withme_partner_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE withme_partner_db;

-- 1. withme_partners Table (Primary Partner & User Record Store)
CREATE TABLE IF NOT EXISTS withme_partners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partner_id VARCHAR(50) NOT NULL UNIQUE,
  user_id VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  full_name VARCHAR(150),
  email VARCHAR(150),
  mobile_number VARCHAR(30) NOT NULL UNIQUE,
  phone_number VARCHAR(30),
  country_code VARCHAR(10) DEFAULT '+91',
  password VARCHAR(255) NOT NULL,
  gender VARCHAR(20) DEFAULT 'Female',
  dob VARCHAR(20),
  age INT DEFAULT 24,
  city VARCHAR(100) DEFAULT 'Jaipur',
  state VARCHAR(100) DEFAULT 'Rajasthan',
  locality VARCHAR(150) DEFAULT 'Vaishali Nagar',
  address TEXT,
  latitude DECIMAL(10, 7) DEFAULT NULL,
  longitude DECIMAL(10, 7) DEFAULT NULL,
  profile_photo_url TEXT,
  image TEXT,
  photos LONGTEXT,
  category VARCHAR(100) DEFAULT 'Coffee',
  activity VARCHAR(100) DEFAULT 'Coffee',
  interests LONGTEXT,
  categories LONGTEXT,
  rating DECIMAL(3,2) DEFAULT 4.80,
  total_reviews INT DEFAULT 0,
  price INT DEFAULT 1,
  price_type VARCHAR(50) DEFAULT 'per session/2hrs',
  currency VARCHAR(10) DEFAULT 'INR',
  pricing LONGTEXT,
  about LONGTEXT,
  available_days LONGTEXT,
  available_from VARCHAR(50) DEFAULT '10:00 AM',
  available_to VARCHAR(50) DEFAULT '09:00 PM',
  availability_status VARCHAR(50) DEFAULT 'Available',
  receive_requests TINYINT(1) DEFAULT 1,
  availability LONGTEXT,
  aadhar_number VARCHAR(50),
  aadhar_front_url TEXT,
  aadhar_back_url TEXT,
  bank_account LONGTEXT,
  withdrawals LONGTEXT,
  fcm_token TEXT,
  kyc_status VARCHAR(50) DEFAULT 'VERIFIED',
  is_approved TINYINT(1) DEFAULT 1,
  is_verified TINYINT(1) DEFAULT 1,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mobile (mobile_number),
  INDEX idx_city (city),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. withme_otps Table (Registration & Reset OTP Store)
CREATE TABLE IF NOT EXISTS withme_otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mobile_number VARCHAR(30) NOT NULL,
  otp VARCHAR(10) NOT NULL,
  type VARCHAR(50) DEFAULT 'registration',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mobile_type (mobile_number, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. withme_partner_requests Table (Incoming & Handled User Requests)
CREATE TABLE IF NOT EXISTS withme_partner_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(50) NOT NULL UNIQUE,
  booking_id VARCHAR(50),
  user_id VARCHAR(50),
  partner_id VARCHAR(50) NOT NULL,
  sender_name VARCHAR(150),
  sender_phone VARCHAR(30),
  sender_avatar TEXT,
  activity VARCHAR(100) DEFAULT 'Coffee',
  date VARCHAR(50),
  time VARCHAR(50),
  location TEXT,
  message TEXT,
  price INT DEFAULT 1,
  status VARCHAR(50) DEFAULT 'PENDING',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_partner_status (partner_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. withme_partner_bookings Table (Upcoming, Complete & Cancelled Bookings)
CREATE TABLE IF NOT EXISTS withme_partner_bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(50) NOT NULL UNIQUE,
  user_id VARCHAR(50),
  partner_id VARCHAR(50) NOT NULL,
  customer_name VARCHAR(150),
  customer_phone VARCHAR(30),
  profile_image TEXT,
  activity VARCHAR(100) DEFAULT 'Coffee',
  date VARCHAR(50),
  time VARCHAR(50),
  duration INT DEFAULT 1,
  location TEXT,
  price INT DEFAULT 1,
  currency VARCHAR(10) DEFAULT 'INR',
  payment_status VARCHAR(50) DEFAULT 'PAID',
  status VARCHAR(50) DEFAULT 'CONFIRMED',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_partner_booking (partner_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. withme_partner_transactions Table (Completed & Pending Earnings Records)
CREATE TABLE IF NOT EXISTS withme_partner_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(50) NOT NULL UNIQUE,
  partner_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(50),
  location TEXT,
  date VARCHAR(50),
  time VARCHAR(50),
  earn_money INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'Complete',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_partner_tx (partner_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. conversations Table (Real-time Socket & REST Private Chat Conversations)
CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type ENUM('private') DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. conversation_members Table (Members Participating in Conversations)
CREATE TABLE IF NOT EXISTS conversation_members (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id VARCHAR(100) NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_member (conversation_id, user_id),
  INDEX idx_user (user_id),
  INDEX idx_conversation (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. messages Table (Chat Messages)
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_id VARCHAR(100) NOT NULL,
  receiver_id VARCHAR(100) NOT NULL,
  message_type ENUM('text') DEFAULT 'text',
  message TEXT NOT NULL,
  is_delivered TINYINT(1) DEFAULT 0,
  is_read TINYINT(1) DEFAULT 0,
  is_deleted TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conversation_created (conversation_id, created_at),
  INDEX idx_receiver_read (receiver_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. user_blocks Table (User & Partner Block Restrictions)
CREATE TABLE IF NOT EXISTS user_blocks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  blocker_id VARCHAR(100) NOT NULL,
  blocked_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_block (blocker_id, blocked_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. withme_notifications Table (Push Notifications Store)
CREATE TABLE IF NOT EXISTS withme_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  notification_id VARCHAR(50) NOT NULL UNIQUE,
  user_id VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  data_payload TEXT,
  is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_read (user_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
