chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tailorCV",
    title: "Tailor My CV",
    contexts: ["selection"]
  });
});

function notifyTab(tabId, message) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg) => window.alert(msg),
    args: [message]
  });
}

async function getGroqKey() {
  const result = await chrome.storage.local.get("groqKey");
  return result.groqKey;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "tailorCV" || !tab?.id) return;

  const jobDescription = info.selectionText || "";
  const { baseCV } = await chrome.storage.local.get("baseCV");
  const groqKey = await getGroqKey();

  if (!baseCV) return notifyTab(tab.id, "Please upload your base CV first via the extension popup.");
  if (!groqKey) return notifyTab(tab.id, "Groq API key missing. Please enter it in the extension popup.");

  const prompt = `You are an AI assistant. Customize the CV below to match the job description. Focus on relevant experience, skills, and keywords.

Job Description:
${jobDescription}

CV:
${baseCV}`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Groq API error:", JSON.stringify(err, null, 2));
      const message = err.error?.message || "Unknown error";
      notifyTab(tab.id, `Groq Error: ${message}`);
      return;
    }

    const completion = await response.json();
    const tailoredCV = completion.choices[0].message.content;

    // Save tailored CV for download via popup
    chrome.storage.local.set({ tailoredCV }, () => {
      notifyTab(tab.id, "Tailored CV generated! Open the extension popup to download.");
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    notifyTab(tab.id, "Failed to generate tailored CV.");
  }
});
