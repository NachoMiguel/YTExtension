// Clear storage only on fresh install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.local.clear(() => {
      console.log("Storage cleared on fresh install.");
    });
  } else if (details.reason === "update") {
    console.log("Extension updated. Keeping data intact.");
  }
});

// Handle extension icon click to open competitor modal
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url || !tab.url.includes("youtube.com")) {
    alert("Please open a YouTube channel page first.");
    return;
  }

  // Inject modal.js script before messaging
  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      files: ["modal.js"],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error("Script injection failed:", chrome.runtime.lastError.message);
        alert("Please open a YouTube channel page first.");
        return;
      }

      // Send message to open modal
      chrome.tabs.sendMessage(tab.id, { action: 'openCompetitorModal' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Message failed:", chrome.runtime.lastError.message);
          alert("Please open a YouTube channel page first.");
        } else {
          console.log(response?.status);
        }
      });
    }
  );
});
