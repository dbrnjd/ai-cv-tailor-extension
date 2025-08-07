importScripts("libs/pdf-lib.min.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tailorCV",
    title: "Tailor My CV",
    contexts: ["selection"]
  });
});

async function getGroqKey() {
  const result = await chrome.storage.local.get("groqKey");
  return result.groqKey;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "tailorCV" || !tab?.id) return;

  const jobDescription = info.selectionText || "";
  const { baseCV } = await chrome.storage.local.get("baseCV");
  const groqKey = await getGroqKey();

  if (!baseCV || !groqKey) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (msg) => alert(msg),
      args: [!baseCV ? "Please upload your base CV first via the extension popup." : "Groq API key missing. Please enter it in the extension popup."]
    });
    return;
  }

  const prompt = `
You are an AI assistant. Customize the CV below to match the job description. Focus on relevant experience, skills, and keywords. Remove irrelevant parts and output the final result in clean, structured format suitable for a UK CV (no explanation).

Job Description:
${jobDescription}

CV:
${baseCV}
`;

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

    const data = await response.json();

    if (!response.ok || !data.choices || !data.choices[0]?.message?.content) {
      throw new Error(data?.error?.message || "No response from Groq");
    }

    const tailoredCV = data.choices[0].message.content.trim();

    // Generate PDF using pdf-lib
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4 size

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 12;
    const margin = 50;
    let y = page.getHeight() - margin;

    const lines = tailoredCV.split("\n");
    for (let line of lines) {
      if (y < margin) {
        const newPage = pdfDoc.addPage([595, 842]);
        y = newPage.getHeight() - margin;
      }
      page.drawText(line, {
        x: margin,
        y: y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
      y -= fontSize + 4;
    }

    const pdfBytes = await pdfDoc.save();
    const base64 = btoa(String.fromCharCode(...pdfBytes));

    const dataUrl = "data:application/pdf;base64," + base64;

    chrome.downloads.download({
      url: dataUrl,
      filename: "Tailored_CV.pdf"
    });

  } catch (err) {
    console.error("Error generating tailored CV:", err.message);
  }
});
