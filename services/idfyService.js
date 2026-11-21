/**
 * WithMe24 - IDfy Aadhaar Verification Service
 * Integration with IDfy Eve API v3
 * Endpoint: https://eve.idfy.com/v3/tasks/async/extract/ind_aadhaar
 */

const crypto = require('crypto');
const fs = require('fs');

const IDFY_ACCOUNT_ID = process.env.IDFY_ACCOUNT_ID || '4f93969f1cd0/2db93a3c-8e20-4107-ac5c-456b0e60ea82';
const IDFY_API_KEY = process.env.IDFY_API_KEY || 'd78bd536-4763-49ce-99d2-4063e2ca1c61';
const IDFY_BASE_URL = process.env.IDFY_BASE_URL || 'https://eve.idfy.com';
const IDFY_AADHAAR_ASYNC_URL = `${IDFY_BASE_URL}/v3/tasks/async/extract/ind_aadhaar`;
const IDFY_TASKS_URL = `${IDFY_BASE_URL}/v3/tasks`;

/**
 * Get standard headers for IDfy API requests
 */
function getIdfyHeaders() {
  return {
    'account-id': process.env.IDFY_ACCOUNT_ID || IDFY_ACCOUNT_ID,
    'api-key': process.env.IDFY_API_KEY || IDFY_API_KEY,
    'Content-Type': 'application/json'
  };
}

/**
 * Convert file object or path or buffer to base64 string
 */
function fileToBase64(file) {
  if (!file) return null;
  if (typeof file === 'string') {
    if (file.startsWith('data:')) {
      const idx = file.indexOf(',');
      return idx !== -1 ? file.slice(idx + 1) : file;
    }
    if (file.startsWith('http://') || file.startsWith('https://')) {
      return file; // URLs can be passed directly
    }
    if (fs.existsSync(file)) {
      return fs.readFileSync(file).toString('base64');
    }
    return file;
  }
  if (Buffer.isBuffer(file)) {
    return file.toString('base64');
  }
  if (file.buffer && Buffer.isBuffer(file.buffer)) {
    return file.buffer.toString('base64');
  }
  if (file.path && fs.existsSync(file.path)) {
    return fs.readFileSync(file.path).toString('base64');
  }
  return null;
}

/**
 * Submit Aadhaar extraction task to IDfy async API
 * @param {Object} params
 * @param {string|Buffer|Object} params.frontDocument - Front image of Aadhaar card (Base64 string or public URL)
 * @param {string|Buffer|Object} params.backDocument - Back image of Aadhaar card (Base64 string or public URL)
 * @param {string} [params.taskId] - Custom UUID for task
 * @param {string} [params.groupId] - Custom UUID for group
 * @returns {Promise<{ success: boolean, request_id?: string, task_id?: string, error?: string, raw?: any }>}
 */
async function submitAadhaarExtraction({ frontDocument, backDocument, taskId, groupId }) {
  try {
    const front = fileToBase64(frontDocument);
    const back = fileToBase64(backDocument) || front;

    if (!front) {
      return { success: false, error: 'FRONT_DOCUMENT_REQUIRED', message: 'Front image of Aadhaar is required.' };
    }

    const finalTaskId = taskId || crypto.randomUUID();
    const finalGroupId = groupId || crypto.randomUUID();

    const payload = {
      task_id: finalTaskId,
      group_id: finalGroupId,
      data: {
        document1: front,
        document2: back,
        consent: 'yes'
      }
    };

    console.log(`[IDfy API] Submitting Aadhaar extraction task ${finalTaskId} to ${IDFY_AADHAAR_ASYNC_URL}`);

    const response = await fetch(IDFY_AADHAAR_ASYNC_URL, {
      method: 'POST',
      headers: getIdfyHeaders(),
      body: JSON.stringify(payload)
    });

    const responseData = await response.json().catch(() => ({}));

    if (response.status === 202 && responseData.request_id) {
      console.log(`[IDfy API] Task created successfully. request_id: ${responseData.request_id}`);
      return {
        success: true,
        request_id: responseData.request_id,
        task_id: finalTaskId,
        group_id: finalGroupId,
        status: 'in_progress',
        raw: responseData
      };
    }

    console.error(`[IDfy API] Task creation failed. Status: ${response.status}`, responseData);
    return {
      success: false,
      status: response.status,
      error: responseData.error || responseData.message || 'IDFY_TASK_CREATION_FAILED',
      message: responseData.message || 'Failed to initiate Aadhaar verification with IDfy.',
      raw: responseData
    };
  } catch (err) {
    console.error(`[IDfy API] Error in submitAadhaarExtraction:`, err.message);
    return {
      success: false,
      error: 'IDFY_NETWORK_ERROR',
      message: err.message
    };
  }
}

/**
 * Fetch task status and extraction result from IDfy
 * @param {string} requestId - The request_id returned by IDfy
 * @returns {Promise<{ success: boolean, status: string, task?: any, raw?: any, error?: string }>}
 */
async function getTaskStatus(requestId) {
  try {
    if (!requestId) {
      return { success: false, error: 'REQUEST_ID_REQUIRED' };
    }

    const url = `${IDFY_TASKS_URL}?request_id=${encodeURIComponent(requestId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: getIdfyHeaders()
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 200) {
      const taskItem = Array.isArray(data) ? data[0] : data;
      if (!taskItem) {
        return { success: false, error: 'NO_TASK_FOUND', raw: data };
      }
      return {
        success: true,
        status: taskItem.status || 'unknown',
        task: taskItem,
        raw: data
      };
    }

    return {
      success: false,
      status: response.status,
      error: data.message || 'FAILED_TO_FETCH_TASK',
      raw: data
    };
  } catch (err) {
    console.error(`[IDfy API] Error fetching task status:`, err.message);
    return {
      success: false,
      error: 'IDFY_FETCH_ERROR',
      message: err.message
    };
  }
}

/**
 * Verify if extracted Aadhaar details match submitted partner details
 * @param {Object} taskItem - IDfy task result item
 * @param {string} submittedAadhaarNumber - 12-digit clean Aadhaar number
 * @returns {{ isVerified: boolean, status: 'APPROVED'|'REJECTED'|'PENDING', reason?: string, details?: any }}
 */
function evaluateExtractionResult(taskItem, submittedAadhaarNumber) {
  if (!taskItem) {
    return { isVerified: false, status: 'PENDING', reason: 'No task data available' };
  }

  const taskStatus = String(taskItem.status || '').toLowerCase();

  if (taskStatus === 'in_progress' || taskStatus === 'pending') {
    return { isVerified: false, status: 'PENDING' };
  }

  if (taskStatus === 'failed') {
    const errorMsg = taskItem.message || taskItem.error || 'Aadhaar image could not be verified by IDfy.';
    return {
      isVerified: false,
      status: 'REJECTED',
      reason: errorMsg
    };
  }

  if (taskStatus === 'completed') {
    const extraction = taskItem.result && taskItem.result.extraction_output;
    if (!extraction) {
      return {
        isVerified: false,
        status: 'REJECTED',
        reason: 'Extraction completed but no identity output returned.'
      };
    }

    // Check Aadhaar ID match
    const extractedId = String(extraction.id_number || '').replace(/\s+/g, '');
    const cleanSubmitted = String(submittedAadhaarNumber || '').replace(/\D/g, '');

    if (cleanSubmitted && extractedId) {
      // Check last 4 digits
      const submittedLast4 = cleanSubmitted.slice(-4);
      const extractedLast4 = extractedId.replace(/\D/g, '').slice(-4);

      if (submittedLast4 && extractedLast4 && submittedLast4 !== extractedLast4) {
        return {
          isVerified: false,
          status: 'REJECTED',
          reason: `Extracted Aadhaar number (${extractedId}) does not match submitted number ending in ${submittedLast4}.`,
          details: extraction
        };
      }
    }

    return {
      isVerified: true,
      status: 'APPROVED',
      details: extraction,
      nameOnCard: extraction.name_on_card || null,
      dob: extraction.date_of_birth || null,
      gender: extraction.gender || null,
      address: extraction.address || null
    };
  }

  return { isVerified: false, status: 'PENDING' };
}

module.exports = {
  IDFY_ACCOUNT_ID,
  IDFY_API_KEY,
  IDFY_BASE_URL,
  IDFY_AADHAAR_ASYNC_URL,
  IDFY_TASKS_URL,
  fileToBase64,
  submitAadhaarExtraction,
  getTaskStatus,
  evaluateExtractionResult
};
