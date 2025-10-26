// Polyfill for Chrome compatibility
if (typeof browser === 'undefined') {
  var browser = chrome;
}

// Background script for the extension
console.log('7TV Extension background script loaded');

// Global state for pasting process
let currentPastingProcess = null;
let shouldStopPasting = false;

// Rate limiter configuration
const RATE_LIMIT = {
  requests: 60, // 60 requests per window (conservative)
  windowMs: 60000, // 1 minute window
  mutationDelay: 1000, // 1 second delay between mutations
};

class RateLimiter {
  constructor(requests, windowMs) {
    this.requests = requests;
    this.windowMs = windowMs;
    this.requestTimes = [];
  }

  async wait() {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requestTimes = this.requestTimes.filter(time => now - time < this.windowMs);
    
    // If we've hit the limit, wait until the oldest request expires
    while (this.requestTimes.length >= this.requests) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = this.windowMs - (now - oldestRequest) + 100; // +100ms buffer
      
      if (waitTime > 0) {
        console.log(`Rate limit reached (${this.requestTimes.length}/${this.requests}), waiting ${Math.ceil(waitTime / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Re-check and clean up after waiting
      const newNow = Date.now();
      this.requestTimes = this.requestTimes.filter(time => newNow - time < this.windowMs);
    }
    
    // Add current request timestamp
    this.requestTimes.push(Date.now());
  }
}

const rateLimiter = new RateLimiter(RATE_LIMIT.requests, RATE_LIMIT.windowMs);

// Listen for extension installation or update
browser.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed/updated', details);
  
  if (details.reason === 'install') {
    // First time installation
    console.log('Extension installed for the first time');
  } else if (details.reason === 'update') {
    // Extension updated
    console.log('Extension updated to version', browser.runtime.getManifest().version);
  }
});

// Listen for messages from content scripts or popup
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received in background:', request);
  
  // Handle different message types
  switch (request.type) {
    case 'GET_DATA':
      browser.storage.local.get(['data'], (result) => {
        sendResponse({ success: true, data: result.data });
      });
      return true;
      
    case 'SET_DATA':
      browser.storage.local.set({ data: request.data }, () => {
        sendResponse({ success: true });
      });
      return true;
      
    case 'EMOTE_SET_SELECTED':
      console.log('Emote set selected:', request.emoteSetName, request.emoteSetId);
      sendResponse({ success: true });
      break;
      
    case 'START_PASTE_PROCESS':
      handleStartPasteProcess(request, sender.tab.id)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'STOP_PASTE_PROCESS':
      handleStopPasteProcess()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'RESUME_PASTE_PROCESS':
      handleResumePasteProcess(sender.tab.id)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

// GraphQL API helper
async function gqlRequest(query, variables, token, isMutation = false) {
  const API_URL = 'https://api.7tv.app/v4/gql';
  
  // Apply rate limiting
  await rateLimiter.wait();
  
  // Extra delay for mutations to be conservative
  if (isMutation) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT.mutationDelay));
  }
  
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }
  
  const json = await response.json();
  
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  
  return json.data;
}

// Fetch emote set
async function fetchEmoteSet(setId, token) {
  const query = `
    query GetEmoteSet($id: String!) {
      emoteSets {
        emoteSet(id: $id) {
          id
          name
          emotes {
            items {
              id
              alias
              emote {
                id
                defaultName
              }
            }
          }
        }
      }
    }
  `;
  
  const data = await gqlRequest(query, { id: setId }, token);
  
  if (!data.emoteSets?.emoteSet) {
    throw new Error('Emote set not found: ' + setId);
  }
  
  return data.emoteSets.emoteSet;
}

// Add emote to set
async function addEmoteToSet(setId, emoteId, alias, token) {
  const mutation = `
    mutation AddEmote($setId: String!, $emoteId: String!, $alias: String) {
      emoteSets {
        emoteSet(id: $setId) {
          addEmote(id: { emoteId: $emoteId, alias: $alias }, overrideConflicts: true) {
            id
            name
          }
        }
      }
    }
  `;
  
  return await gqlRequest(mutation, { setId, emoteId, alias }, token, true);
}

// Notify content script
async function notifyContentScript(tabId, message) {
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.error('Failed to notify content script:', error);
  }
}

// Handle start paste process
async function handleStartPasteProcess(request, tabId) {
  const { sourceSetId, targetSetId, targetSetName, token } = request;
  
  // Force stop any existing process
  if (currentPastingProcess && currentPastingProcess.isActive) {
    console.log('Stopping existing process before starting new one');
    shouldStopPasting = true;
    currentPastingProcess = null;
    await browser.storage.local.set({ currentPastingProcess: null });
    // Give it a moment to clean up
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  shouldStopPasting = false;
  
  try {
    // Notify: Loading source
    await notifyContentScript(tabId, {
      type: 'PASTE_PROGRESS',
      status: 'loading',
      message: 'Загрузка исходного сета...'
    });
    
    const sourceSet = await fetchEmoteSet(sourceSetId, token);
    console.log(`Source set loaded: ${sourceSet.name} (${sourceSet.emotes.items.length} emotes)`);
    
    if (shouldStopPasting) throw new Error('Остановлено пользователем');
    
    // Notify: Loading target
    await notifyContentScript(tabId, {
      type: 'PASTE_PROGRESS',
      status: 'loading',
      message: 'Загрузка целевого сета...'
    });
    
    const targetSet = await fetchEmoteSet(targetSetId, token);
    const targetAliases = new Set(targetSet.emotes.items.map(e => e.alias));
    console.log(`Target set loaded: ${targetSet.name} (${targetSet.emotes.items.length} emotes)`);
    
    if (shouldStopPasting) throw new Error('Остановлено пользователем');
    
    // Filter duplicates
    const emotesToAdd = sourceSet.emotes.items.filter(e => !targetAliases.has(e.alias));
    const total = emotesToAdd.length;
    const skipped = sourceSet.emotes.items.length - total;
    
    if (total === 0) {
      await notifyContentScript(tabId, {
        type: 'PASTE_COMPLETE',
        status: 'info',
        message: 'Все эмоуты уже есть в целевом сете!'
      });
      return { success: true, total: 0, added: 0, failed: 0, skipped };
    }
    
    // Save process state
    currentPastingProcess = {
      isActive: true,
      sourceSetId,
      targetSetId,
      targetSetName,
      emotesToAdd,
      total,
      skipped,
      added: 0,
      failed: 0,
      currentIndex: 0,
      startTime: Date.now(),
      tabId
    };
    await browser.storage.local.set({ currentPastingProcess });
    
    // Notify: Starting
    await notifyContentScript(tabId, {
      type: 'PASTE_PROGRESS',
      status: 'processing',
      message: `Добавление ${total} эмоутов...`,
      progress: 0,
      total
    });
    
    // Start processing
    await processPastingQueue(token, tabId);
    
    return { success: true };
    
  } catch (error) {
    console.error('Error starting paste process:', error);
    currentPastingProcess = null;
    await browser.storage.local.set({ currentPastingProcess: null });
    
    await notifyContentScript(tabId, {
      type: 'PASTE_ERROR',
      status: 'error',
      message: error.message
    });
    
    return { success: false, error: error.message };
  }
}

// Process pasting queue
async function processPastingQueue(token, tabId) {
  if (!currentPastingProcess) return;
  
  const { emotesToAdd, targetSetId, total, skipped } = currentPastingProcess;
  let { added, failed, currentIndex } = currentPastingProcess;
  
  for (let i = currentIndex; i < emotesToAdd.length; i++) {
    // Check stop flag at the beginning of each iteration
    if (shouldStopPasting || !currentPastingProcess) {
      console.log('Pasting stopped by user');
      await notifyContentScript(tabId, {
        type: 'PASTE_STOPPED',
        status: 'stopped',
        message: `Остановлено. Добавлено ${added} из ${total} эмоутов`,
        added,
        failed,
        total,
        skipped
      });
      
      // Clean up immediately
      currentPastingProcess = null;
      shouldStopPasting = false;
      await browser.storage.local.set({ currentPastingProcess: null });
      return;
    }
    
    const emoteItem = emotesToAdd[i];
    const progress = i + 1;
    
    // Update state (check if still exists)
    if (currentPastingProcess) {
      currentPastingProcess.currentIndex = i;
      currentPastingProcess.added = added;
      currentPastingProcess.failed = failed;
      await browser.storage.local.set({ currentPastingProcess });
    }
    
    // Notify progress
    await notifyContentScript(tabId, {
      type: 'PASTE_PROGRESS',
      status: 'processing',
      progress,
      total,
      message: `${progress}/${total}`
    });
    
    try {
      console.log(`[${progress}/${total}] Adding: ${emoteItem.alias}`);
      await addEmoteToSet(targetSetId, emoteItem.emote.id, emoteItem.alias, token);
      added++;
      if (currentPastingProcess) {
        currentPastingProcess.added = added;
      }
      console.log(`[${progress}/${total}] ✓ Added: ${emoteItem.alias}`);
    } catch (err) {
      failed++;
      if (currentPastingProcess) {
        currentPastingProcess.failed = failed;
      }
      console.warn(`[${progress}/${total}] ✗ Failed: ${emoteItem.alias} - ${err.message}`);
      
      // If rate limited, add extra delay with stop checks
      if (err.message.includes('rate') || err.message.includes('limit') || err.message.includes('429')) {
        console.log('Rate limit detected, waiting 5 seconds...');
        await notifyContentScript(tabId, {
          type: 'PASTE_PROGRESS',
          status: 'waiting',
          message: 'Ограничение API, ожидание...'
        });
        
        // Wait with interrupt capability (check every 500ms)
        for (let j = 0; j < 10; j++) {
          if (shouldStopPasting || !currentPastingProcess) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }
  
  // Completion (only if not stopped)
  if (!shouldStopPasting && currentPastingProcess) {
    await notifyContentScript(tabId, {
      type: 'PASTE_COMPLETE',
      status: failed > 0 ? 'error' : 'success',
      message: `Готово! Добавлено ${added} из ${total} эмоутов` + (failed > 0 ? ` (ошибок: ${failed})` : ''),
      added,
      failed,
      total,
      skipped
    });
  }
  
  // Clean up
  currentPastingProcess = null;
  shouldStopPasting = false;
  await browser.storage.local.set({ currentPastingProcess: null });
}

// Handle stop paste process
async function handleStopPasteProcess() {
  console.log('Stop requested');
  shouldStopPasting = true;
  
  // Don't immediately clear - let the process clean itself up
  // Just mark for stopping
  if (currentPastingProcess) {
    currentPastingProcess.isActive = false;
  }
  
  return { success: true };
}

// Handle resume paste process
async function handleResumePasteProcess(tabId) {
  const result = await browser.storage.local.get(['currentPastingProcess']);
  const savedProcess = result.currentPastingProcess;
  
  if (!savedProcess || !savedProcess.isActive) {
    return { success: false, error: 'Нет сохраненного процесса' };
  }
  
  console.log('Resuming pasting process...');
  currentPastingProcess = savedProcess;
  currentPastingProcess.tabId = tabId;
  shouldStopPasting = false;
  
  await notifyContentScript(tabId, {
    type: 'PASTE_PROGRESS',
    status: 'resuming',
    message: `Продолжение с ${savedProcess.currentIndex + 1}/${savedProcess.total}...`,
    progress: savedProcess.currentIndex,
    total: savedProcess.total
  });
  
  // Get token from storage or request from content script
  const tokenResult = await browser.storage.local.get(['7tv-token']);
  const token = tokenResult['7tv-token'];
  
  if (!token) {
    return { success: false, error: '7TV token не найден' };
  }
  
  // Continue processing
  await processPastingQueue(token, tabId);
  
  return { success: true };
}

// Listen for tab updates (optional)
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('7tv.app')) {
    console.log('7TV tab loaded:', tab.url);
    
    // Check if this is a user emote-sets page
    if (tab.url.includes('/users/') && tab.url.includes('/emote-sets')) {
      console.log('Переключились на страницу emote-sets пользователя');
      
      // Send message to content script
      browser.tabs.sendMessage(tabId, {
        type: 'EMOTE_SETS_PAGE_LOADED',
        url: tab.url
      }).catch(err => {
        console.log('Не удалось отправить сообщение в content script:', err);
      });
    }
  }
});

// Listen for tab activation (when user switches between tabs)
browser.tabs.onActivated.addListener((activeInfo) => {
  browser.tabs.get(activeInfo.tabId).then(tab => {
    if (tab.url?.includes('/users/') && tab.url?.includes('/emote-sets')) {
      console.log('Переключились на вкладку с emote-sets');
      
      // Send message to content script
      browser.tabs.sendMessage(activeInfo.tabId, {
        type: 'EMOTE_SETS_TAB_ACTIVATED',
        url: tab.url
      }).catch(err => {
        console.log('Не удалось отправить сообщение в content script:', err);
      });
    }
  });
});
