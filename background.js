// background.js — service worker for Tailor CV
// Requirements: libs/jspdf.umd.min.js must exist in extension's libs/ folder

importScripts("libs/jspdf.umd.min.js");

const jsPDFCtor = (self.jspdf && self.jspdf.jsPDF) ? self.jspdf.jsPDF : null;
if (!jsPDFCtor) {
  console.error("jsPDF not loaded. Put libs/jspdf.umd.min.js in the libs/ folder.");
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function notifyTab(tabId, message) {
  try {
    chrome.scripting.executeScript({
      target: { tabId },
      func: (m) => alert(m),
      args: [message]
    });
  } catch (e) {
    console.warn("notifyTab failed", e);
  }
}

function arrayBufferToDataUrl(arrayBuffer, mime = "application/pdf") {
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const sub = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, sub);
  }
  const base64 = btoa(binary);
  return `data:${mime};base64,${base64}`;
}

function isHeading(line) {
  if (!line) return false;
  const norm = line.trim().replace(/:$/, "").toLowerCase();
  const headings = [
    "summary", "personal statement", "skills", "key skills", "experience", "work experience",
    "project", "projects", "education", "certifications", "certifications & training"
  ];
  return headings.includes(norm) || headings.some(h => norm.startsWith(h));
}

function isBullet(line) {
  if (!line) return false;
  const t = line.trim();
  return t.startsWith("•") || t.startsWith("-") || t.startsWith("*") || /^\d+\./.test(t);
}

function stripModelIntro(text) {
  if (!text) return "";
  const introductoryPhrases = [
    /^here is the rewritten cv:\s*/i,
    /^based on the information provided, here is a tailored cv:\s*/i,
    /^i have updated your cv based on the job description:\s*/i,
    /^below is the updated cv:\s*/i,
  ];

  for (const phrase of introductoryPhrases) {
    if (phrase.test(text)) {
      return text.replace(phrase, '').trim();
    }
  }

  const firstHeadingMatch = text.match(/^(summary|skills|project|projects|work experience|certifications|education)/i);
  if (firstHeadingMatch) {
    const headingIndex = text.indexOf(firstHeadingMatch[0]);
    if (headingIndex > 0) {
      return text.substring(headingIndex).trim();
    }
  }
  
  return text.trim();
}

function renderCvToArrayBuffer(cvText, personalDetails) {
  if (!jsPDFCtor) throw new Error("jsPDF not available");

  const doc = new jsPDFCtor({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const usableWidth = pageWidth - margin * 2;

  const headingFontSize = 13;
  const nameFontSize = 16;
  const bodyFontSize = 11;
  const lineGap = 6;
  const sectionGap = 18;
  const bulletIndent = 12;
  const skillsColumnGap = 12;
  const skillsVerticalGap = 4;

  let cursorY = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(nameFontSize);
  doc.text(personalDetails.fullName, margin, cursorY);
  cursorY += nameFontSize + lineGap;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(bodyFontSize);
  doc.text(personalDetails.jobTitle, margin, cursorY);
  cursorY += bodyFontSize + lineGap;
  
  const contactInfo = [
    personalDetails.phoneNumber,
    personalDetails.email,
    personalDetails.location,
    personalDetails.linkedin
  ];
  if (personalDetails.github) {
    contactInfo.push(personalDetails.github);
  }
  doc.text(contactInfo.join(" • "), margin, cursorY);
  cursorY += bodyFontSize + lineGap;
  
  cursorY += sectionGap;

  const norm = cvText.replace(/\r/g, "");
  const lines = norm.split("\n");
  
  let currentParagraph = [];
  let currentHeading = "";
  let isProjectsSection = false;
  let projectsBuffer = [];
  let projectTitle = null;
  let projectDescription = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const paragraphText = currentParagraph.join(" ");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(bodyFontSize);
      const wrapped = doc.splitTextToSize(paragraphText, usableWidth);
      for (const w of wrapped) {
        if (cursorY > pageHeight - margin) {
          doc.addPage();
          cursorY = margin;
        }
        doc.text(w, margin, cursorY);
        cursorY += bodyFontSize + lineGap;
      }
      currentParagraph = [];
      cursorY += lineGap;
    }
  };

  const renderProjects = () => {
    if (projectsBuffer.length > 0) {
      for (const project of projectsBuffer) {
        // Render project title in bold
        doc.setFont("helvetica", "bold");
        doc.setFontSize(bodyFontSize);
        const wrappedTitle = doc.splitTextToSize(project.title, usableWidth);
        for (const w of wrappedTitle) {
          if (cursorY > pageHeight - margin) {
            doc.addPage();
            cursorY = margin;
          }
          doc.text(w, margin, cursorY);
          cursorY += bodyFontSize + lineGap;
        }

        // Render description in normal font
        if (project.description.length > 0) {
          const descriptionText = project.description.join(" ");
          doc.setFont("helvetica", "normal");
          const wrappedDesc = doc.splitTextToSize(descriptionText, usableWidth);
          for (const w of wrappedDesc) {
            if (cursorY > pageHeight - margin) {
              doc.addPage();
              cursorY = margin;
            }
            doc.text(w, margin, cursorY);
            cursorY += bodyFontSize + lineGap;
          }
        }
        cursorY += lineGap; // Extra space between projects
      }
      projectsBuffer = [];
    }
  };
  
  let skillsList = [];
  const flushSkills = () => {
    if (skillsList.length > 0) {
      const numSkills = skillsList.length;
      let numColumns = 1;
      if (numSkills >= 15) numColumns = 3;
      else if (numSkills >= 6) numColumns = 2;

      const columnWidth = (usableWidth - skillsColumnGap * (numColumns - 1)) / numColumns;
      const skillsPerColumn = Math.ceil(numSkills / numColumns);
      
      let columnStartY = cursorY;
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(bodyFontSize);

      for (let i = 0; i < numSkills; i++) {
        const skillText = "• " + skillsList[i];
        const colIndex = Math.floor(i / skillsPerColumn);
        const rowIndex = i % skillsPerColumn;
        
        const xPos = margin + colIndex * (columnWidth + skillsColumnGap);
        let yPos = columnStartY + rowIndex * (bodyFontSize + skillsVerticalGap);

        if (yPos > pageHeight - margin) {
            doc.addPage();
            columnStartY = margin;
            yPos = columnStartY + rowIndex * (bodyFontSize + skillsVerticalGap);
        }
        doc.text(skillText, xPos, yPos);
      }
      cursorY = Math.max(cursorY, columnStartY + skillsPerColumn * (bodyFontSize + skillsVerticalGap)) + lineGap;
      skillsList = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "") {
      flushParagraph();
      flushSkills();
      if (isProjectsSection && projectTitle) {
        projectsBuffer.push({ title: projectTitle, description: projectDescription });
        projectTitle = null;
        projectDescription = [];
      }
      continue;
    }

    if (isHeading(line)) {
      flushParagraph();
      flushSkills();
      if (isProjectsSection) {
        if (projectTitle) {
          projectsBuffer.push({ title: projectTitle, description: projectDescription });
        }
        renderProjects();
      }
      cursorY += sectionGap;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(headingFontSize);
      doc.text(line.replace(/:$/, ""), margin, cursorY);
      cursorY += headingFontSize + 6;
      currentHeading = line.toLowerCase().trim();
      isProjectsSection = (currentHeading === "project" || currentHeading === "projects");
      continue;
    }

    if (currentHeading.startsWith("skills") && isBullet(line)) {
      skillsList.push(line.replace(/^[-*•\s]*\s*/, ""));
      continue;
    }
    
    // NEW LOGIC: Projects section parsing that handles titles and descriptions
    if (isProjectsSection) {
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        // This line contains a project title and description
        if (projectTitle) {
          // Push previous project to buffer before starting a new one
          projectsBuffer.push({ title: projectTitle, description: projectDescription });
        }
        projectTitle = line.substring(0, colonIndex).trim().replace(/^[-*•\s]*\s*/, "");
        projectDescription = [line.substring(colonIndex + 1).trim().replace(/^[-*•\s]*\s*/, "")];
      } else if (projectTitle) {
        // Subsequent lines are part of the description for the current project
        projectDescription.push(line.trim());
      } else {
        // First line in projects section without a colon is the first title
        projectTitle = line.trim().replace(/^[-*•\s]*\s*/, "");
        projectDescription = [];
      }
      continue;
    }
    
    if (isBullet(line)) {
      flushParagraph();
      flushSkills();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(bodyFontSize);
      
      const bulletText = line.replace(/^[-*•\s]*\s*/, "");
      const wrapped = doc.splitTextToSize(bulletText, usableWidth - bulletIndent);
      for (const w of wrapped) {
        if (cursorY > pageHeight - margin) {
          doc.addPage();
          cursorY = margin;
        }
        doc.text("• " + w, margin + bulletIndent, cursorY);
        cursorY += bodyFontSize + lineGap;
      }
      continue;
    }
    
    currentParagraph.push(line);
  }
  
  flushParagraph();
  flushSkills();
  if (isProjectsSection) {
    if (projectTitle) {
      projectsBuffer.push({ title: projectTitle, description: projectDescription });
    }
    renderProjects();
  }
  
  return doc.output("arraybuffer");
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tailorCV",
    title: "Tailor My CV",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "tailorCV") return;
  if (!tab?.id) return;

  const selectedText = (info.selectionText || "").trim();
  if (!selectedText) {
    notifyTab(tab.id, "Please select the job description text before using Tailor My CV.");
    return;
  }

  try {
    const store = await storageGet(["groqKey", "baseCV", "fullName", "jobTitle", "phoneNumber", "email", "location", "linkedin", "github"]);
    const { groqKey, baseCV, fullName, jobTitle, phoneNumber, email, location, linkedin, github } = store;

    if (!groqKey) {
      notifyTab(tab.id, "Groq API key missing. Open extension settings and paste your key.");
      return;
    }
    if (!baseCV) {
      notifyTab(tab.id, "Base CV not found. Upload your base CV in the extension settings.");
      return;
    }
    if (!fullName || !jobTitle || !phoneNumber || !email || !location || !linkedin) {
      notifyTab(tab.id, "Personal details missing. Please fill in your name, job title, and contact info in the extension settings.");
      return;
    }

    const prompt = `You are a CV tailoring assistant. Take the provided CV and job description, then rewrite the CV to:
- Match the role with relevant skills, experience, and keywords.
- Maintain UK ATS-friendly standards.
- Ensure the following sections are included and appear in this exact order:
1. Summary
2. Skills (bullet points)
3. Projects (bullet points)
4. Work Experience (reverse chronological, bullet points for achievements)
5. Certifications
6. Education

Do NOT include any introductory or closing text, explanations, or notes.
Do NOT include the name, job title, or contact information.

Job description:
${selectedText}

Base CV:
${baseCV}`;

    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: "llama3-70b-8192",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.0
      })
    });

    if (!resp.ok) {
      let errText = await resp.text().catch(() => "No error message provided.");
      console.error("Groq API error:", resp.status, errText);
      notifyTab(tab.id, `Groq API error: ${resp.status}. Check console for details.`);
      return;
    }

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || data.output?.[0]?.content || "";
    if (!raw || raw.trim() === "") {
      console.error("Empty AI response:", data);
      notifyTab(tab.id, "AI returned no content. Try again or check your API key/quota.");
      return;
    }

    const cleaned = stripModelIntro(raw);

    const personalDetails = { fullName, jobTitle, phoneNumber, email, location, linkedin, github };
    const pdfArrayBuffer = renderCvToArrayBuffer(cleaned, personalDetails);

    const dataUrl = arrayBufferToDataUrl(pdfArrayBuffer, "application/pdf");
    chrome.downloads.download({ url: dataUrl, filename: "Tailored_CV.pdf" }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("chrome.downloads.download error:", chrome.runtime.lastError);
        notifyTab(tab.id, "Download failed. Check console for details.");
      }
    });

  } catch (err) {
    console.error("Error in tailoring flow:", err);
    notifyTab(tab.id, "An unexpected error occurred. See console for details.");
  }
});