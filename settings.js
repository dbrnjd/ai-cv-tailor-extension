pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";

document.getElementById("saveBtn").addEventListener("click", async () => {
  const groqKey = document.getElementById("groqKey").value.trim();
  const fileInput = document.getElementById("cvFile");
  const file = fileInput.files[0];
  const status = document.getElementById("status");

  const fullName = document.getElementById("fullName").value.trim();
  const jobTitle = document.getElementById("jobTitle").value.trim();
  const phoneNumber = document.getElementById("phoneNumber").value.trim();
  const email = document.getElementById("email").value.trim();
  const location = document.getElementById("location").value.trim();
  const linkedin = document.getElementById("linkedin").value.trim();
  const github = document.getElementById("github").value.trim();

  status.style.display = "block";
  status.textContent = "";
  status.className = "";

  if (!fullName || !jobTitle || !phoneNumber || !email || !location || !linkedin) {
    status.textContent = "Please fill in all personal details.";
    status.className = "status-error";
    return;
  }
  
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
      baseCV: text,
      fullName,
      jobTitle,
      phoneNumber,
      email,
      location,
      linkedin,
      github
    });

    status.textContent = "Settings saved successfully.";
    status.className = "status-success";

    fileInput.value = "";
    document.getElementById("groqKey").value = "";
  } catch (err) {
    console.error("Error reading PDF:", err);
    status.textContent = `Error processing CV file: ${err.message}`;
    status.className = "status-error";
  }
});