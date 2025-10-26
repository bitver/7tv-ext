// Polyfill for Chrome compatibility
if (typeof browser === 'undefined') {
  var browser = chrome;
}

// Popup script
console.log('7TV Extension popup loaded');

// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

// Load settings from storage
function loadSettings() {
  chrome.storage.local.get(['enableEmotes', 'enableTooltips'], (result) => {
    document.getElementById('enableEmotes').checked = result.enableEmotes !== false;
    document.getElementById('enableTooltips').checked = result.enableTooltips !== false;
  });
}

// Setup event listeners
function setupEventListeners() {
  // Save settings when checkboxes change
  document.getElementById('enableEmotes').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableEmotes: e.target.checked });
    notifyContentScript({ type: 'SETTINGS_CHANGED', setting: 'enableEmotes', value: e.target.checked });
  });
  
  document.getElementById('enableTooltips').addEventListener('change', (e) => {
    chrome.storage.local.set({ enableTooltips: e.target.checked });
    notifyContentScript({ type: 'SETTINGS_CHANGED', setting: 'enableTooltips', value: e.target.checked });
  });
  
  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });
  
  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.reload(tabs[0].id);
      }
    });
  });
  
  // About link
  document.getElementById('aboutLink').addEventListener('click', (e) => {
    e.preventDefault();
    // Open about page or modal
    console.log('About clicked');
  });
  
  // Help link
  document.getElementById('helpLink').addEventListener('click', (e) => {
    e.preventDefault();
    // Open help page
    console.log('Help clicked');
  });
}

// Notify content script of changes
function notifyContentScript(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, message);
    }
  });
}
