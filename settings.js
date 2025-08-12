document.addEventListener('DOMContentLoaded', () => {
  if (typeof pdfjsLib === 'undefined') {
    const status = document.getElementById("status");
    status.style.display = "block";
    status.className = "status-error";
    status.textContent = "Error: The PDF.js library was not loaded correctly. Please ensure 'pdf.umd.min.js' is in your 'libs' folder.";
    console.error("Critical Error: pdfjsLib is not defined. The PDF.js library file 'pdf.umd.min.js' is either missing, corrupted, or not being loaded properly.");
    return;
  }
  
  pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";

  chrome.storage.local.get(["groqKey"], (items) => {
    document.getElementById("groqKey").value = items.groqKey || "";
  });

  document.getElementById("saveBtn").addEventListener("click", async () => {
    const groqKey = document.getElementById("groqKey").value.trim();
    const fileInput = document.getElementById("cvFile");
    const file = fileInput.files[0];
    const status = document.getElementById("status");
    
    status.style.display = "block";
    status.textContent = "";
    status.className = "";
    
    if (!groqKey) {
      status.textContent = "Please enter your Groq API key.";
      status.className = "status-error";
      return;
    }
    
    if (!file || file.type !== "application/pdf") {
      status.textContent = "Please upload a valid PDF file.";
      status.className = "status-error";
      return;
    }
    
    status.textContent = "Processing PDF and saving settings...";
    status.className = "status-info";

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(" ");
        text += pageText + "\n\n";
      }
      
      await chrome.storage.local.set({
        groqKey,
        baseCV: text
      });
      
      status.textContent = "Settings saved successfully.";
      status.className = "status-success";
    } catch (err) {
      console.error("Error saving settings:", err);
      status.textContent = `An error occurred while saving settings: ${err.message}.`;
      status.className = "status-error";
    }
  });
});