// Options page script
console.log('7TV Extension options page loaded');

// Load saved settings on page load
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get(['enableEmotes', 'enableTooltips', 'debugMode'], (result) => {
    document.getElementById('enableEmotes').checked = result.enableEmotes !== false;
    document.getElementById('enableTooltips').checked = result.enableTooltips !== false;
    document.getElementById('debugMode').checked = result.debugMode === true;
  });
}

// Setup event listeners
function setupEventListeners() {
  // Save button
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  
  // Reset button
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
}

// Save settings to storage
function saveSettings() {
  const settings = {
    enableEmotes: document.getElementById('enableEmotes').checked,
    enableTooltips: document.getElementById('enableTooltips').checked,
    debugMode: document.getElementById('debugMode').checked
  };
  
  chrome.storage.local.set(settings, () => {
    showStatusMessage('Settings saved successfully!', 'success');
    
    // Notify all tabs about the settings change
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_CHANGED',
          settings: settings
        }).catch(() => {
          // Ignore errors for tabs that don't have the content script
        });
      });
    });
  });
}

// Reset settings to defaults
function resetSettings() {
  const defaultSettings = {
    enableEmotes: true,
    enableTooltips: true,
    debugMode: false
  };
  
  chrome.storage.local.set(defaultSettings, () => {
    loadSettings();
    showStatusMessage('Settings reset to defaults', 'success');
  });
}

// Show status message
function showStatusMessage(message, type) {
  const statusElement = document.getElementById('statusMessage');
  statusElement.textContent = message;
  statusElement.className = `status-message ${type}`;
  
  setTimeout(() => {
    statusElement.className = 'status-message';
  }, 3000);
}
