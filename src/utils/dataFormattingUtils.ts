// src/utils/dataFormattingUtils.ts
// Various utils used througho out project for formatting data like dates, undefined values etc.

/* 
====================================================================
DATE FORMATTING
====================================================================
*/

/**
 * Converts various timestamp formats to a Date object
 */
export const toDate = (timestamp: any): Date | null => {
  // If truly missing, return null
  if (timestamp === null || timestamp === undefined) {
    return null;
  }

  // Firestore Timestamp object (has .toDate() method)
  if (timestamp.toDate && typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }

  // Raw Firestore timestamp format (plain object with seconds/nanoseconds)
  if (timestamp.seconds !== undefined && timestamp.nanoseconds !== undefined) {
    // Convert seconds to milliseconds and add nanoseconds converted to milliseconds
    return new Date(timestamp.seconds * 1000 + timestamp.nanoseconds / 1000000);
  }

  // Already a Date object
  if (timestamp instanceof Date) {
    return timestamp;
  }

  // String (ISO or other parseable format)
  if (typeof timestamp === 'string') {
    const parsed = new Date(timestamp);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // Number (Unix timestamp in milliseconds)
  if (typeof timestamp === 'number') {
    // Timestamps < 10 billion are likely in seconds (dates before ~2286 in seconds, but before ~1970 April in ms)
    // This threshold safely distinguishes: year 2001+ in ms is > 1 trillion
    if (timestamp < 10_000_000_000) {
      return new Date(timestamp * 1000);
    }
    return new Date(timestamp);
  }

  // Fallback
  console.warn('Unable to convert timestamp:', timestamp);
  return null;
};

/**
 * Converts timestamp to ISO string for storage/API calls
 * Use this when saving to databases or sending via API
 */
export const toISOString = (timestamp: any): string => {
  const date = toDate(timestamp);

  // If date is null or invalid, return current timestamp as fallback
  if (!date || isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
};

/**
 * Date format options for formatTimestamp
 */
export type DateFormatOption =
  | 'short' // "Nov 6, 2025, 4:35 PM"
  | 'long' // "Wed, Nov 6, 2025, 4:35 PM"
  | 'date-only' // "November 6, 2025"
  | 'date-short' // "Nov 6, 2025"
  | 'month-year' // "Nov 2025"
  | 'time-only' // "4:35 PM"
  | 'relative' // "2 hours ago" / "yesterday"
  | 'chat' // Today --> "4:20PM", This week --> "Mon" older --> "Apr 20"
  | 'custom'; // Use custom options parameter

/**
 * Formats timestamp for user-friendly display
 *
 * @param timestamp - Any timestamp format (Firestore Timestamp, Date, ISO string)
 * @param format - Predefined format option (default: 'short')
 * @param customOptions - Custom Intl.DateTimeFormatOptions (only used when format is 'custom')
 *
 * @example
 * formatTimestamp(myDate) // "Nov 6, 2025, 4:35 PM"
 * formatTimestamp(myDate, 'long') // "Wed, Nov 6, 2025, 4:35 PM"
 * formatTimestamp(myDate, 'date-only') // "November 6, 2025"
 * formatTimestamp(myDate, 'month-year') // "Nov 2025"
 * formatTimestamp(myDate, 'relative') // "2 hours ago"
 */
export const formatTimestamp = (
  timestamp: any,
  format: DateFormatOption = 'short',
  customOptions?: Intl.DateTimeFormatOptions
): string => {
  const date = toDate(timestamp);

  // Handle null/invalid dates - check BEFORE using date
  if (!date || isNaN(date.getTime())) {
    return 'Unknown date';
  }

  switch (format) {
    case 'short':
      return date.toLocaleString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

    case 'long':
      return date.toLocaleString('en-GB', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

    case 'date-only':
      return date.toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

    case 'date-short':
      return date.toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

    case 'month-year':
      return date.toLocaleDateString('en-GB', {
        month: 'short',
        year: 'numeric',
      });

    case 'time-only':
      return date.toLocaleTimeString('en-GB', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

    case 'relative':
      return formatRelativeTime(timestamp);

    case 'chat': {
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      if (isToday) {
        return date.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });
      }
      const daysDiff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff < 7) {
        return date.toLocaleDateString('en-GB', { weekday: 'short' });
      }
      return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
    }

    case 'custom':
      if (!customOptions) {
        console.warn(
          'Custom format requested but no customOptions provided. Falling back to "short".'
        );
        return date.toLocaleString('en-GB', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
      }
      return date.toLocaleString('en-GB', customOptions);

    default:
      return date.toLocaleString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
  }
};

/**
 * Formats timestamp as relative time (e.g., "2 hours ago", "yesterday")
 * Falls back to absolute date if more than a week old
 */
export const formatRelativeTime = (timestamp: any): string => {
  const date = toDate(timestamp);

  // Handle null/invalid dates
  if (!date || isNaN(date.getTime())) {
    return 'Unknown date';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins === 1) return '1 minute ago';
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  // More than a week - show absolute date
  return formatTimestamp(timestamp, 'date-short');
};

/**
 * Number of whole days between now and the given timestamp (ceil, so "in 3.2 days" reads as
 * "4 days" remaining — matches how a deadline countdown should round). Negative once the
 * timestamp has passed. Accepts any format toDate() understands (Firestore Timestamp,
 * TimestampLike, Date, ISO string, Unix ms/seconds). Returns 0 for a null/unparseable timestamp —
 * a safe default that reads as "due now" rather than silently hiding a malformed deadline.
 */
export const getDaysUntil = (timestamp: any): number => {
  const date = toDate(timestamp);
  if (!date) return 0;
  const ms = date.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
};

/**
 * Formats a Date as a local YYYY-MM-DD string for `<input type="date">` values.
 * Unlike `date.toISOString().split('T')[0]`, this uses local time components,
 * so it won't shift to the previous/next day for users off UTC.
 */
export const toDateInputValue = (date: Date = new Date()): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Data formatting utility for calculating age based on Birthday
 * @param dob takes Date of Birth as a date object
 * @returns age as a number
 */
export const calculateAge = (dob: Date) => {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
};

/* 
===================================================================
UNDEFINED DATA FORMATTING
===================================================================
*/

/**
 * Recursively removes undefined values from objects and arrays
 * Firestore doesn't allow undefined - must be null or omitted
 * Also used in Blockchain Service
 */
export const removeUndefinedValues = <T>(data: T): T => {
  if (Array.isArray(data)) {
    return data.map(item => removeUndefinedValues(item)) as T;
  }

  if (data !== null && typeof data === 'object' && '_methodName' in (data as any)) {
    return data;
  }

  if (data !== null && typeof data === 'object') {
    const cleaned: any = {};
    for (const key in data) {
      const value = (data as any)[key];
      if (value !== undefined) {
        cleaned[key] = removeUndefinedValues(value);
      }
    }
    return cleaned as T;
  }

  return (data === undefined ? null : data) as T;
};

/* 
====================================================================
BASE64 TO ARRAYBUFFER FORMATTING
====================================================================
Base64 is how text is represented using 64 safe characters (A-Z, a-z, 0-9, +, /)
ArrayBuffer is a raw binary format used for processing in JavaScript. 

Process is usually: 
1. User uploads a file in ArrayBuffer/Blob format
2. Convert to base64 for storage
3. retrieve as base64
4. convert back to ArrayBuffer for processing in browser

*/

/**
 * Converts an ArrayBuffer to a base64 string.
 * Useful for storing/transmitting binary data (like encryption keys or ciphertext) as text.
 */
export const arrayBufferToBase64 = (buffer: ArrayBufferLike): string => {
  const bytes = new Uint8Array(buffer);
  const binary = Array.from(bytes)
    .map(byte => String.fromCharCode(byte))
    .join('');
  return btoa(binary);
};

/**
 * Converts a base64 string back to an ArrayBuffer.
 * Used to decode stored/transmitted encryption data back to binary format.
 */
export const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Convert hex string to Uint8Array
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string (e.g., [10, 255] -> "0aff")
 */
export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
export const hexToArrayBuffer = (hex: string): ArrayBuffer => {
  const matches = hex.match(/[\da-f]{2}/gi);
  if (!matches) return new Uint8Array([]).buffer;
  return new Uint8Array(matches.map(h => parseInt(h, 16))).buffer;
};

/**
 * Converts a File or Blob object to a base64-encoded string.
 * This is the standard way to prepare attachments (images/PDFs)
 * for the AI multimodal payload.
 * * @param file - The File object from an input or drop zone
 * @returns Promise<string> - The base64 string (including data URL prefix)
 */
export const fileToBase64 = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    // Set up the event handlers
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert file to base64 string'));
      }
    };

    reader.onerror = error => reject(error);

    // Start reading the file
    reader.readAsDataURL(file);
  });
};

//====================================================================
//NUMBER FORMATTING
//====================================================================

/**
 * Calculate percentage with bounds checking
 */
export function calculatePercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

/**
 * Format a large number with K/M suffix
 */
export function formatLargeNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Truncate a string to a maximum length, appending an ellipsis if necessary
 */
export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

/**
 * Truncate a hash/ID for display, showing the start and last 4 characters.
 * Returns '—' for empty/undefined values.
 * Example: "0xabcdef1234...5678"
 */
export function truncateHash(s: string | undefined, chars = 10): string {
  if (!s) return '—';
  if (s.length <= chars + 4) return s;
  return `${s.slice(0, chars)}…${s.slice(-4)}`;
}
