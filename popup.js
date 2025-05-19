let isModalOpening = false;

document.getElementById('openCompetitorsBtn').addEventListener('click', () => {
  if (isModalOpening) return;
  isModalOpening = true;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      isModalOpening = false;
      alert('No active tab found.');
      return;
    }

    // ✅ Inject BOTH content.js and modal.js
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js', 'modal.js']
    }, () => {
      chrome.tabs.sendMessage(tab.id, { action: 'openCompetitorModal' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Message sending error:", chrome.runtime.lastError.message);
          alert('Please navigate to a YouTube channel page to open the competitors dashboard.');
        } else {
          console.log("Response from content script:", response?.status);
        }
        isModalOpening = false;
      });
    });
  });
});
