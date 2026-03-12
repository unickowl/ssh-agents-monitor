'use strict'

// Notifications are now handled by Electron's native Notification API
// (see electron/notifications.js). These are no-op stubs for compatibility
// with polling.js which calls detectAndNotify().

function notify() {}
function detectAndNotify() {}

module.exports = { notify, detectAndNotify }
