pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";

document.getElementById("saveBtn").addEventListener("click", async () => {
  const groqKey = document.getElementById("groqKey").value.trim();
  const file = document.getElementById("cvFile").files[0];
  const status = document.getElementById("status");

  if (!groqKey) {
    status.textContent = "Please enter your Groq API key.";
    status.style.color = "red";
    return;
  }

  if (!file || file.type !== "application/pdf") {
    status.textContent = "Please upload a valid PDF file.";
    status.style.color = "red";
    return;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(" ") + "\n";
    }

    await chrome.storage.local.set({ groqKey, baseCV: text });
    status.textContent = "Settings saved successfully.";
    status.style.color = "green";
  } catch (err) {
    console.error("Error reading PDF:", err);
    status.textContent = "Error processing CV file.";
    status.style.color = "red";
  }
});
