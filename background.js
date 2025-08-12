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

function stripModelIntro(text) {
  if (!text) return "";
  const introductoryPhrases = [
    /^here is the rewritten cv:\s*/i,
    /^based on the information provided, here is a tailored cv:\s*/i,
    /^i have updated your cv based on the job description:\s*/i,
    /^below is the updated cv:\s*/i,
    /^here's a tailored cv based on the provided information:\s*/i
  ];
  for (const phrase of introductoryPhrases) {
    if (phrase.test(text)) {
      return text.replace(phrase, '').trim();
    }
  }
  return text.trim();
}

function parseGroqResponseAndRender(groqResponse) {
  if (!jsPDFCtor) throw new Error("jsPDF not available");

  const cleanedResponse = stripModelIntro(groqResponse);
  const lines = cleanedResponse.split('\n');

  const doc = new jsPDFCtor({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const usableWidth = pageWidth - margin * 2;

  const headingFontSize = 13;
  const nameFontSize = 16;
  const jobTitleFontSize = 12;
  const bodyFontSize = 11;
  const lineGap = 6;
  const sectionGap = 18;
  const bulletIndent = 12;
  const skillsColumnGap = 12;
  const skillsVerticalGap = 4;

  let cursorY = margin;
  let currentSection = null;
  let skillsList = [];
  let nameTitleAndContactHandled = false;

  const flushSkills = () => {
    if (skillsList.length === 0) return;

    let numColumns = 2;
    const columnWidth = (usableWidth - skillsColumnGap) / numColumns;
    const skillsPerColumn = Math.ceil(skillsList.length / numColumns);
    
    let columnYs = Array(numColumns).fill(cursorY);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(bodyFontSize);
    doc.setLineHeightFactor(1.2);

    for (let i = 0; i < skillsList.length; i++) {
      const skillText = "• " + skillsList[i];
      const colIndex = Math.floor(i / skillsPerColumn);
      
      const yPos = columnYs[colIndex];
      
      const wrapped = doc.splitTextToSize(skillText, columnWidth - 8);
      
      if (yPos + (wrapped.length * (bodyFontSize + skillsVerticalGap)) > pageHeight - margin) {
        doc.addPage();
        columnYs = Array(numColumns).fill(margin);
        cursorY = margin;
        columnYs[colIndex] = margin;
      }

      const xPos = margin + colIndex * (columnWidth + skillsColumnGap);
      
      for (const w of wrapped) {
        doc.text(w, xPos, columnYs[colIndex]);
        columnYs[colIndex] += bodyFontSize + skillsVerticalGap;
      }
    }
    
    cursorY = Math.max(...columnYs) + sectionGap;
    skillsList = [];
  };
  
  const isBullet = (line) => {
    if (!line) return false;
    const t = line.trim();
    return t.startsWith("•") || t.startsWith("-") || t.startsWith("*") || /^\d+\./.test(t);
  };
  
  const isHeading = (line) => {
    return line.match(/^\*\*(.*)\*\*/);
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    if (!trimmedLine) {
      if (currentSection === "skills") {
        flushSkills();
      }
      continue;
    }

    if (!nameTitleAndContactHandled) {
      if (i === 0) {
        const name = trimmedLine.replace(/\*\*/g, "").replace(/^\s*•\s*/, "");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(nameFontSize);
        doc.text(name, margin, cursorY);
        cursorY += nameFontSize + lineGap;
        continue;
      }
      
      if (i === 1) {
        const title = trimmedLine.replace(/\*\*/g, "").replace(/^\s*•\s*/, "");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(jobTitleFontSize);
        doc.text(title, margin, cursorY);
        cursorY += jobTitleFontSize + lineGap;
        continue;
      }
      
      if (i === 2) {
        const contactInfo = trimmedLine.replace(/\*\*/g, "").replace(/\|/g, " | ");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(bodyFontSize);
        const wrappedContent = doc.splitTextToSize(contactInfo, usableWidth);
        for (const w of wrappedContent) {
            if (cursorY > pageHeight - margin) {
                doc.addPage();
                cursorY = margin;
            }
            doc.text(w, margin, cursorY);
            cursorY += bodyFontSize + lineGap;
        }
        nameTitleAndContactHandled = true;
        continue;
      }
    }
    
    const headingMatch = trimmedLine.match(/^\*\*(.*)\*\*/);
    if (headingMatch) {
      flushSkills();
      const headingText = headingMatch[1].trim().replace(/:$/, '');
      doc.setFont("helvetica", "bold");
      doc.setFontSize(headingFontSize);
      cursorY += sectionGap;
      doc.text(headingText, margin, cursorY);
      cursorY += headingFontSize + lineGap;
      currentSection = headingText.toLowerCase().trim().replace(/\s/g, "");
      continue;
    }
    
    if (isBullet(trimmedLine)) {
      const bulletText = trimmedLine.replace(/^[-*•\s]*\s*/, "");
      if (currentSection === "skills") {
        skillsList.push(bulletText);
        continue;
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(bodyFontSize);
      const wrapped = doc.splitTextToSize(bulletText, usableWidth - bulletIndent);
      
      if (cursorY > pageHeight - margin) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text("• " + wrapped[0], margin + bulletIndent, cursorY);
      cursorY += bodyFontSize + lineGap;

      for (let j = 1; j < wrapped.length; j++) {
        if (cursorY > pageHeight - margin) {
          doc.addPage();
          cursorY = margin;
        }
        doc.text(wrapped[j], margin + bulletIndent, cursorY);
        cursorY += bodyFontSize + lineGap;
      }
      continue;
    }
    
    if (trimmedLine) {
        flushSkills();
        doc.setFont("helvetica", "normal");
        doc.setFontSize(bodyFontSize);
        const wrapped = doc.splitTextToSize(trimmedLine, usableWidth);
        for (const w of wrapped) {
            if (cursorY > pageHeight - margin) {
                doc.addPage();
                cursorY = margin;
            }
            doc.text(w, margin, cursorY);
            cursorY += bodyFontSize + lineGap;
        }
    }
  }

  flushSkills();

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
    const store = await storageGet(["groqKey", "baseCV"]);
    const { groqKey, baseCV } = store;

    if (!groqKey) {
      notifyTab(tab.id, "Groq API key missing. Open extension settings and paste your key.");
      return;
    }
    if (!baseCV) {
      notifyTab(tab.id, "Base CV not found. Upload your base CV in the extension settings.");
      return;
    }
    
    const prompt = `You are a CV tailoring assistant. Take the provided base CV and job description, then rewrite the CV to:
- Match the role with relevant skills, experience, and keywords.
- Maintain UK ATS-friendly standards.
- Output the user's full name on the first line in **bold**.
- Output a professional job title on the next line in **bold** and a smaller font size.
- On the third line, output the contact information (email, phone, location, and social media links) in a normal font style.
- Separate all contact details with a pipe character "|". Do not include any labels or headings for them.
- Use **bold** for all other section headings like **Summary**, **Skills**, etc.
- Use a single bullet point (•) for all list items. Ensure that each bullet point contains a complete thought or sentence, without breaking it up with extra bullet points or blank lines.
- Ensure the following sections are included and appear in this exact order:
1. Full Name
2. Job Title
3. Contact Information (on a single line, separated by |)
4. Summary
5. Skills (bullet points)
6. Projects (bullet points)
7. Work Experience (reverse chronological, with job titles and bullet points for achievements)
8. Certifications
9. Education

Do NOT include any introductory or closing text, explanations, or notes.
Your response should start directly with the user's full name.

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
    const raw = data.choices?.[0]?.message?.content || "";
    if (!raw || raw.trim() === "") {
      console.error("Empty AI response:", data);
      notifyTab(tab.id, "AI returned no content. Try again or check your API key/quota.");
      return;
    }
    
    const pdfArrayBuffer = parseGroqResponseAndRender(raw);

    const dataUrl = arrayBufferToDataUrl(pdfArrayBuffer, "application/pdf");
    chrome.downloads.download({ url: dataUrl, filename: `Tailored_CV.pdf` }, (downloadId) => {
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