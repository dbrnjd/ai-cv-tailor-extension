pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";

// Upload and extract CV from PDF
document.getElementById("cvFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  const status = document.getElementById("uploadStatus");

  if (!file || file.type !== "application/pdf") {
    status.textContent = "Please upload a valid PDF file.";
    status.style.color = "red";
    return;
  }

  const reader = new FileReader();
  reader.onload = async function () {
    const typedarray = new Uint8Array(this.result);
    try {
      const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
      let text = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(" ") + "\n";
      }

      chrome.storage.local.set({ baseCV: text }, () => {
        status.textContent = "CV uploaded and parsed successfully.";
        status.style.color = "green";
      });
    } catch (err) {
      console.error("PDF parsing error:", err);
      status.textContent = "Failed to parse PDF.";
      status.style.color = "red";
    }
  };

  reader.readAsArrayBuffer(file);
});

// Save API Key
document.getElementById("saveKey").addEventListener("click", () => {
  const keyInput = document.getElementById("groqKey");
  const key = keyInput.value.trim();
  const keyStatus = document.getElementById("keyStatus");

  if (!key) {
    keyStatus.textContent = "Please enter a key.";
    keyStatus.style.color = "red";
    return;
  }

  chrome.storage.local.set({ groqKey: key }, () => {
    keyStatus.textContent = "API key saved.";
    keyStatus.style.color = "green";
    keyInput.value = "";
  });
});

// Download tailored CV
document.getElementById("downloadBtn").addEventListener("click", () => {
  chrome.storage.local.get("tailoredCV", (result) => {
    const text = result.tailoredCV;
    const downloadStatus = document.getElementById("downloadStatus");

    if (!text) {
      downloadStatus.textContent = "No tailored CV found.";
      downloadStatus.style.color = "red";
      return;
    }

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "TailoredCV.txt";
    link.click();
    URL.revokeObjectURL(url);

    downloadStatus.textContent = "Download started!";
    downloadStatus.style.color = "green";
  });
});
