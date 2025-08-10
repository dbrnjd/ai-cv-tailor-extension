// background.js — service worker for Tailor CV
// Requirements: libs/jspdf.umd.min.js must exist in extension's libs/ folder

// Load jsPDF UMD into service worker (synchronous)
importScripts("libs/jspdf.umd.min.js");

// Grab constructor
const jsPDFCtor = (self.jspdf && self.jspdf.jsPDF) ? self.jspdf.jsPDF : null;
if (!jsPDFCtor) {
  console.error("jsPDF not loaded. Put libs/jspdf.umd.min.js in the libs/ folder.");
}

// --- Helpers ---------------------------------------------------------------

// promisified storage.get
function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

// notify (alert) inside the tab
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

// Convert ArrayBuffer -> base64 data URL (safe in SW)
function arrayBufferToDataUrl(arrayBuffer, mime = "application/pdf") {
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks to avoid call stack issues
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const sub = uint8.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, sub);
  }
  const base64 = btoa(binary);
  return `data:${mime};base64,${base64}`;
}

// Detect heading lines (common CV headings)
function isHeading(line) {
  if (!line) return false;
  const norm = line.trim().replace(/:$/, "").toLowerCase();
  const headings = [
    "name", "name & contact", "contact", "profile", "summary", "personal statement",
    "skills", "key skills", "experience", "work experience",
    "education", "certifications", "certifications & training", "projects"
  ];
  return headings.includes(norm) || headings.some(h => norm.startsWith(h));
}

// Detect bullet line
function isBullet(line) {
  if (!line) return false;
  const t = line.trim();
  return t.startsWith("•") || t.startsWith("-") || t.startsWith("*") || /^\d+\./.test(t);
}

// Clean leading meta/explanatory text commonly returned by LLMs
function stripModelIntro(text) {
  if (!text) return "";
  // Remove upfront lines that look like "Here is...", "I've reformatted..." up to first heading
  // Find first heading index (case-insensitive)
  const lower = text.toLowerCase();
  const headings = ["name", "name & contact", "profile", "summary", "skills", "experience", "education"];
  let idx = -1;
  for (const h of headings) {
    const i = lower.indexOf("\n" + h);
    if (i !== -1) idx = (idx === -1) ? i : Math.min(idx, i);
  }
  // Fallback: search headings at start of text (without newline)
  if (idx === -1) {
    for (const h of headings) {
      const i = lower.indexOf(h);
      if (i !== -1) idx = (idx === -1) ? i : Math.min(idx, i);
    }
  }
  if (idx > 0) {
    text = text.slice(idx);
  }
  // Remove common leading phrases
  text = text.replace(/^(here('?s| is)|i have|i've|the revised cv|the tailored cv)[^\n]*\n*/i, "");
  return text.trim();
}

// --- PDF rendering --------------------------------------------------------
//
// Render a clean, ATS-friendly UK CV using jsPDF. We will:
//  - Render headings bold
//  - Render bullets with "•"
//  - Keep Skills right after Summary according to your preference
//  - Keep Education at the end (prompt ensures order)
//
// This renderer is intentionally simple (no images) to remain ATS-friendly.
//

function renderCvToArrayBuffer(cvText) {
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

  let cursorY = margin;

  // Normalize newlines, remove excess spaces
  const norm = cvText.replace(/\r/g, "");
  const lines = norm.split("\n");

  // Function to write wrapped text and handle page breaks
  function writeWrapped(text, fontSize = bodyFontSize, fontStyle = "normal", indent = 0) {
    doc.setFont("helvetica", fontStyle);
    doc.setFontSize(fontSize);
    const availWidth = usableWidth - indent;
    const wrapped = doc.splitTextToSize(text, availWidth);
    for (const w of wrapped) {
      if (cursorY > pageHeight - margin) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text(w, margin + indent, cursorY);
      cursorY += fontSize + lineGap;
    }
  }

  // First pass: try to detect a top name/contact block: first non-empty line(s) before first heading
  // We'll detect name as the first non-empty line (uppercase or capitalized) and treat it larger.
  let i = 0;
  // skip initial blank lines
  while (i < lines.length && lines[i].trim() === "") i++;

  // If first line looks like a name (contains letters and spaces, short), render as name header
  if (i < lines.length) {
    const first = lines[i].trim();
    if (first.length > 0 && first.length < 60) {
      // render name
      doc.setFont("helvetica", "bold");
      doc.setFontSize(nameFontSize);
      doc.text(first, margin, cursorY);
      cursorY += nameFontSize + lineGap;
      i++;
      // collect subsequent short lines as contact until we hit an empty line
      let contactLines = [];
      while (i < lines.length && lines[i].trim() !== "") {
        contactLines.push(lines[i].trim());
        i++;
      }
      if (contactLines.length) {
        writeWrapped(contactLines.join(" • "), bodyFontSize, "normal", 0);
        cursorY += 4;
      }
      // skip blank(s)
      while (i < lines.length && lines[i].trim() === "") i++;
    }
  }

  // Process remaining lines (basic parsing: headings, bullets, paragraphs)
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\u2022/g, "•").trim();

    if (line === "") {
      // paragraph break
      cursorY += lineGap;
      continue;
    }

    if (isHeading(line)) {
      // render heading
      doc.setFont("helvetica", "bold");
      doc.setFontSize(headingFontSize);
      if (cursorY > pageHeight - margin) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text(line.replace(/:$/, ""), margin, cursorY);
      cursorY += headingFontSize + 6;
      continue;
    }

    if (isBullet(line)) {
      // render bullet with indentation
      const bullet = line.replace(/^[-*•\s]*\s*/, "");
      writeWrapped("• " + bullet, bodyFontSize, "normal", 12);
      continue;
    }

    // else normal paragraph line
    writeWrapped(line, bodyFontSize, "normal", 0);
  }

  // Return ArrayBuffer (safe to build Blob from this in SW)
  return doc.output("arraybuffer");
}

// --- Context menu setup ---------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tailorCV",
    title: "Tailor My CV",
    contexts: ["selection"]
  });
});

// --- Main handler ---------------------------------------------------------
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
    const groqKey = store.groqKey;
    const baseCV = store.baseCV;

    if (!groqKey) {
      notifyTab(tab.id, "Groq API key missing. Open extension settings and paste your key.");
      return;
    }
    if (!baseCV) {
      notifyTab(tab.id, "Base CV not found. Upload your base CV in the extension settings.");
      return;
    }

    // Strict prompt: only return the CV content, ordered with Skills after Summary and Education last.
    const prompt = `You are a CV tailoring assistant. Take the provided CV and job description, then rewrite the CV to:
- Match the role with relevant skills, experience, and keywords.
- Maintain UK ATS-friendly standards.
- Include the following sections in this exact order:
1. Full Name
2. Job Title
3. Contact Information (email, phone, LinkedIn, location)
4. Summary
5. Skills (bullet points)
6. Work Experience (reverse chronological, bullet points for achievements)
7. Certifications
8. Education

Do NOT include any introductory or closing text, explanations, or notes.

Job description:
${selectedText}

Base CV:
${baseCV}`;

    // Call Groq (OpenAI-compatible endpoint)
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
      let errText = await resp.text().catch(() => null);
      console.error("Groq API error:", resp.status, errText);
      notifyTab(tab.id, `Groq API error: ${resp.status}`);
      return;
    }

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || data.output?.[0]?.content || "";
    if (!raw || raw.trim() === "") {
      console.error("Empty AI response:", data);
      notifyTab(tab.id, "AI returned no content. Try again or check your API key/quota.");
      return;
    }

    // Strip any leading explanatory lines just in case
    const cleaned = stripModelIntro(raw);

    // Render PDF to ArrayBuffer
    const pdfArrayBuffer = renderCvToArrayBuffer(cleaned);

    // Convert to data URI and download (avoid createObjectURL issues)
    const dataUrl = arrayBufferToDataUrl(pdfArrayBuffer, "application/pdf");
    chrome.downloads.download({ url: dataUrl, filename: "Tailored_CV.pdf" }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("chrome.downloads.download error:", chrome.runtime.lastError);
        notifyTab(tab.id, "Download failed. Check console for details.");
      } else {
        // optionally notify success
        // notifyTab(tab.id, "Tailored CV downloaded.");
      }
    });

  } catch (err) {
    console.error("Error in tailoring flow:", err);
    notifyTab(tab.id, "An unexpected error occurred. See console for details.");
  }
});
