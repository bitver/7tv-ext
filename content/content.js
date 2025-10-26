// Content script that runs on 7TV pages
console.log("7TV Extension content script loaded");

// Global state
let copiedEmoteSetData = null;
let isPasting = false;
let currentPasteButton = null; // Store current paste button

// browser.runtime.sendMessage({ type: "GET_DATA" }, (response) => {
//   if (response.success) {
//     console.log("Data received from background:", response.data);
//   } else {
//     console.error("Error fetching data from background:", response.error);
//   }
// });

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received in content script:', request);
  
  // Handle different message types
  switch (request.type) {
    case 'EMOTE_SETS_PAGE_LOADED':
      console.log('Emote sets page loaded:', request.url);
      init();
      sendResponse({ success: true });
      break;
      
    case 'EMOTE_SETS_TAB_ACTIVATED':
      console.log('Emote sets tab activated:', request.url);
      init();
      sendResponse({ success: true });
      break;
      
    case 'PASTE_PROGRESS':
      handlePasteProgress(request);
      break;
      
    case 'PASTE_COMPLETE':
      handlePasteComplete(request);
      break;
      
    case 'PASTE_STOPPED':
      handlePasteStopped(request);
      break;
      
    case 'PASTE_ERROR':
      handlePasteError(request);
      break;
  }
});

// Initialize the extension
async function init() {
  console.log("Initializing 7TV Extension on 7TV site");

  const token = get7TVToken();
  
  // Save token to storage for background script
  if (token) {
    await browser.storage.local.set({ '7tv-token': token });
  }

  // Restore copied data from storage
  try {
    const result = await browser.storage.local.get(['copiedEmoteSetData', 'currentPastingProcess']);
    if (result.copiedEmoteSetData) {
      copiedEmoteSetData = result.copiedEmoteSetData;
      console.log('Restored copied emote set data:', copiedEmoteSetData.sourceName);
    }
    if (result.currentPastingProcess && result.currentPastingProcess.isActive) {
      console.log('Restored pasting process:', result.currentPastingProcess);
      
      // Find and resume the paste button
      setTimeout(() => {
        const emoteSets = document.querySelectorAll('a.emote-set');
        for (const emoteSet of emoteSets) {
          const href = emoteSet.getAttribute('href');
          const emoteSetId = href ? href.split('/').pop() : null;
          
          if (emoteSetId === result.currentPastingProcess.targetSetId) {
            const pasteButton = emoteSet.querySelector('.paste-button-7tv-ext');
            if (pasteButton) {
              currentPasteButton = pasteButton;
              isPasting = true;
              showNotification('Обнаружен незавершенный процесс вставки. Возобновление...', 'info');
              
              // Ask background to resume
              browser.runtime.sendMessage({ type: 'RESUME_PASTE_PROCESS' });
            }
            break;
          }
        }
      }, 1000);
    }
  } catch (error) {
    console.error('Error restoring copied data:', error);
  }

  // Add choose buttons to all emote sets
  addChooseButtonsToEmoteSets();
}

// Add choose buttons to each emote set
function addChooseButtonsToEmoteSets() {
  // Find all emote-set elements
  const emoteSets = document.querySelectorAll('a.emote-set');
  
  console.log(`Found ${emoteSets.length} emote sets`);
  
  // First, reset all existing copy buttons to default state
  document.querySelectorAll('.copy-button-7tv-ext').forEach(btn => {
    btn.textContent = '📋 Копировать';
    btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  });
  
  emoteSets.forEach((emoteSet, index) => {
    // Skip if button already added
    if (emoteSet.querySelector('.button-container-7tv-ext')) {
      // Update existing button if this is the copied set
      const href = emoteSet.getAttribute('href');
      const emoteSetId = href ? href.split('/').pop() : null;
      const isCopiedSet = copiedEmoteSetData && copiedEmoteSetData.sourceId === emoteSetId;
      
      if (isCopiedSet) {
        const copyButton = emoteSet.querySelector('.copy-button-7tv-ext');
        if (copyButton) {
          copyButton.textContent = '✓ Скопировано';
          copyButton.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        }
      }
      
      return;
    }
    
    // Extract emote set ID from href
    const href = emoteSet.getAttribute('href');
    const emoteSetId = href ? href.split('/').pop() : null;
    
    // Extract emote set name
    const nameElement = emoteSet.querySelector('.name');
    const emoteSetName = nameElement ? nameElement.textContent : 'Unknown';
    
    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container-7tv-ext';
    buttonContainer.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      gap: 8px;
      z-index: 10;
    `;
    
    // Create copy button
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button-7tv-ext';
    
    // Check if this is the copied set
    const isCopiedSet = copiedEmoteSetData && copiedEmoteSetData.sourceId === emoteSetId;
    
    copyButton.textContent = isCopiedSet ? '✓ Скопировано' : '📋 Копировать';
    copyButton.style.cssText = `
      padding: 6px 12px;
      background: ${isCopiedSet ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'};
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: bold;
      font-size: 12px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;
    
    // Create paste button (initially hidden)
    const pasteButton = document.createElement('button');
    pasteButton.className = 'paste-button-7tv-ext';
    pasteButton.textContent = '📥 Вставить';
    pasteButton.style.cssText = `
      padding: 6px 12px;
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: bold;
      font-size: 12px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      display: ${copiedEmoteSetData ? 'block' : 'none'};
    `;
    
    // Add hover effects for copy button
    copyButton.addEventListener('mouseenter', () => {
      copyButton.style.transform = 'scale(1.05)';
      copyButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
    });
    
    copyButton.addEventListener('mouseleave', () => {
      copyButton.style.transform = 'scale(1)';
      copyButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    });
    
    // Add hover effects for paste button
    pasteButton.addEventListener('mouseenter', () => {
      pasteButton.style.transform = 'scale(1.05)';
      pasteButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
    });
    
    pasteButton.addEventListener('mouseleave', () => {
      pasteButton.style.transform = 'scale(1)';
      pasteButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
    });
    
    // Copy button click handler
    copyButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      await handleCopyEmoteSet(emoteSetId, emoteSetName, copyButton);
    });
    
    // Paste button click handler
    pasteButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      await handlePasteEmoteSet(emoteSetId, emoteSetName, pasteButton);
    });
    
    // Make parent element position relative
    emoteSet.style.position = 'relative';
    
    // Add buttons to container
    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(pasteButton);
    
    // Add container to emote set
    emoteSet.appendChild(buttonContainer);
  });
}

// Handle copying emote set
async function handleCopyEmoteSet(emoteSetId, emoteSetName, buttonElement) {
  console.log(`Copying emote set ID: ${emoteSetName} (${emoteSetId})`);
  
  // Reset all other copy buttons
  document.querySelectorAll('.copy-button-7tv-ext').forEach(btn => {
    btn.textContent = '📋 Копировать';
    btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  });
  
  // Simply store the source set ID and name
  copiedEmoteSetData = {
    sourceId: emoteSetId,
    sourceName: emoteSetName,
    timestamp: Date.now()
  };
  
  console.log(`Copied source set: ${emoteSetName}`);
  
  // Update button
  buttonElement.textContent = '✓ Скопировано';
  buttonElement.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
  
  // Show all paste buttons
  updatePasteButtonsVisibility();
  
  // Save to storage
  await browser.storage.local.set({ copiedEmoteSetData });
  
  // Show notification
  showNotification(`Скопирован сет "${emoteSetName}"`, 'success');
}

// Handle pasting emote set
async function handlePasteEmoteSet(targetSetId, targetSetName, buttonElement) {
  if (!copiedEmoteSetData) {
    showNotification('Сначала скопируйте эмоуты из другого сета!', 'error');
    return;
  }
  
  // If already pasting, stop the process
  if (isPasting) {
    buttonElement.textContent = '⏹️ Остановлено';
    buttonElement.style.background = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
    buttonElement.disabled = true;
    showNotification('Остановка процесса...', 'info');
    
    // Ask background to stop
    browser.runtime.sendMessage({ type: 'STOP_PASTE_PROCESS' });
    
    // Reset state immediately
    isPasting = false;
    
    // Re-enable button after a short delay
    setTimeout(() => {
      buttonElement.textContent = '📥 Вставить';
      buttonElement.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
      buttonElement.disabled = false;
    }, 1000);
    
    return;
  }
  
  const sourceSetId = copiedEmoteSetData.sourceId;
  const token = get7TVToken();
  
  if (!token) {
    showNotification('7TV token не найден. Добавьте его в localStorage как "7tv-token"', 'error');
    return;
  }
  
  // Save token to storage for background
  await browser.storage.local.set({ '7tv-token': token });
  
  console.log(`Requesting paste from background: ${sourceSetId} -> ${targetSetId}`);
  
  // Update button state
  buttonElement.textContent = '⏳ Загрузка...';
  currentPasteButton = buttonElement;
  isPasting = true;
  
  // Send request to background script
  const response = await browser.runtime.sendMessage({
    type: 'START_PASTE_PROCESS',
    sourceSetId,
    targetSetId,
    targetSetName,
    token
  });
  
  if (!response.success) {
    isPasting = false;
    currentPasteButton = null;
    buttonElement.textContent = '❌ Ошибка';
    buttonElement.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
    showNotification(`Ошибка: ${response.error}`, 'error');
    
    setTimeout(() => {
      buttonElement.textContent = '📥 Вставить';
      buttonElement.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
      buttonElement.disabled = false;
    }, 3000);
  }
}

// Handle paste progress updates from background
function handlePasteProgress(data) {
  if (!currentPasteButton) return;
  
  const { status, message, progress, total } = data;
  
  if (status === 'loading') {
    currentPasteButton.textContent = '⏳ Загрузка...';
    showNotification(message, 'info');
  } else if (status === 'processing') {
    currentPasteButton.textContent = `⏸️ ${progress}/${total}`;
  } else if (status === 'waiting') {
    showNotification(message, 'info');
  } else if (status === 'resuming') {
    currentPasteButton.textContent = '⏳ Возобновление...';
    showNotification(message, 'info');
  }
}

// Handle paste completion from background
function handlePasteComplete(data) {
  if (!currentPasteButton) return;
  
  const { status, message, added, total, failed } = data;
  
  currentPasteButton.textContent = '✓ Вставлено';
  currentPasteButton.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
  
  showNotification(message, failed > 0 ? 'error' : 'success');
  
  isPasting = false;
  
  setTimeout(() => {
    if (currentPasteButton) {
      currentPasteButton.textContent = '📥 Вставить';
      currentPasteButton.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
      currentPasteButton.disabled = false;
      currentPasteButton = null;
    }
  }, 3000);
}

// Handle paste stopped from background
function handlePasteStopped(data) {
  if (!currentPasteButton) return;
  
  const { message } = data;
  
  currentPasteButton.textContent = '⏹️ Остановлено';
  currentPasteButton.style.background = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
  
  showNotification(message, 'info');
  
  isPasting = false;
  
  setTimeout(() => {
    if (currentPasteButton) {
      currentPasteButton.textContent = '📥 Вставить';
      currentPasteButton.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
      currentPasteButton.disabled = false;
      currentPasteButton = null;
    }
  }, 3000);
}

// Handle paste error from background
function handlePasteError(data) {
  if (!currentPasteButton) return;
  
  const { message } = data;
  
  currentPasteButton.textContent = '❌ Ошибка';
  currentPasteButton.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
  
  showNotification(`Ошибка: ${message}`, 'error');
  
  isPasting = false;
  
  setTimeout(() => {
    if (currentPasteButton) {
      currentPasteButton.textContent = '📥 Вставить';
      currentPasteButton.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
      currentPasteButton.disabled = false;
      currentPasteButton = null;
    }
  }, 3000);
}

// Update visibility of paste buttons
function updatePasteButtonsVisibility() {
  document.querySelectorAll('.paste-button-7tv-ext').forEach(btn => {
    if (copiedEmoteSetData) {
      btn.style.display = 'block';
    } else {
      btn.style.display = 'none';
    }
  });
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = 'notification-7tv-ext';
  notification.textContent = message;
  
  const colors = {
    success: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    error: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    info: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
  };
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    background: ${colors[type] || colors.info};
    color: white;
    border-radius: 8px;
    font-weight: bold;
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease;
    max-width: 400px;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

// Add CSS animations
if (!document.getElementById('7tv-ext-styles')) {
  const style = document.createElement('style');
  style.id = '7tv-ext-styles';
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

// Observe DOM changes to add buttons to dynamically loaded emote sets
const observer = new MutationObserver((mutations) => {
  // Check if any mutation is NOT from our extension
  const hasRelevantMutation = mutations.some(mutation => {
    // Ignore mutations in our own elements
    if (mutation.target.classList?.contains('button-container-7tv-ext') ||
        mutation.target.classList?.contains('copy-button-7tv-ext') ||
        mutation.target.classList?.contains('paste-button-7tv-ext') ||
        mutation.target.classList?.contains('notification-7tv-ext') ||
        mutation.target.closest('.button-container-7tv-ext')) {
      return false;
    }
    
    // Ignore if mutation is only text content change in our buttons
    if (mutation.type === 'characterData' && 
        mutation.target.parentElement?.classList?.contains('copy-button-7tv-ext')) {
      return false;
    }
    if (mutation.type === 'characterData' && 
        mutation.target.parentElement?.classList?.contains('paste-button-7tv-ext')) {
      return false;
    }
    
    // Only react to new nodes being added (not our buttons)
    if (mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        // Skip our own elements
        if (node.classList?.contains('button-container-7tv-ext') ||
            node.classList?.contains('notification-7tv-ext') ||
            node.id === '7tv-ext-styles') {
          continue;
        }
        return true;
      }
    }
    
    return false;
  });
  
  if (hasRelevantMutation) {
    addChooseButtonsToEmoteSets();
  }
});

// Start observing
if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Check and retrieve 7TV token from localStorage
function get7TVToken() {
  const token = localStorage.getItem("7tv-token");
  if (token) {
    console.log("7TV Extension: Token found in localStorage");
    return token;
  }
  console.log(
    "7TV Extension: No token found. Please add 7tv-token to localStorage"
  );
  return null;
}
