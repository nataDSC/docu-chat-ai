const WEBHOOK_URL = "https://maarseek.app.n8n.cloud/webhook-test/upload";
const ALLOWED_EXTENSIONS = ["txt", "pdf", "csv"];

const form = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const selectedFile = document.getElementById("selected-file");
const submitButton = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const dropzone = document.getElementById("dropzone");
const payloadPreview = document.getElementById("payload-preview");
const multipartKeysEl = document.getElementById("multipart-keys");
const copyPayloadButton = document.getElementById("copy-payload-btn");

const METADATA_KEYS = [
  "filename",
  "size",
  "mimeType",
  "extension",
  "uploadedAt",
];

function getFileExtension(fileName) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function isAllowedFile(file) {
  return ALLOWED_EXTENSIONS.includes(getFileExtension(file.name));
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function createMetadataPayload(file) {
  return {
    filename: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    extension: getFileExtension(file.name),
    uploadedAt: new Date().toISOString(),
  };
}

function renderPayloadPreview(file) {
  if (!file) {
    multipartKeysEl.textContent = "Multipart keys: data, file";
    payloadPreview.textContent = "Select a file to preview metadata payload.";
    return;
  }

  const metadata = createMetadataPayload(file);
  multipartKeysEl.textContent = `Multipart keys: data, file, ${METADATA_KEYS.join(", ")}`;
  payloadPreview.textContent = JSON.stringify(metadata, null, 2);
}

function setSelectedFile(file) {
  if (!file) {
    selectedFile.textContent = "No file selected";
    submitButton.disabled = true;
    renderPayloadPreview(null);
    return;
  }

  selectedFile.textContent = `Selected: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`;
  submitButton.disabled = false;
  renderPayloadPreview(file);
}

function handleFileSelection(file) {
  if (!file) {
    setSelectedFile(null);
    setStatus("");
    return;
  }

  if (!isAllowedFile(file)) {
    fileInput.value = "";
    setSelectedFile(null);
    setStatus(
      "Invalid file type. Please upload a .txt, .pdf, or .csv file.",
      "error",
    );
    return;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;

  setSelectedFile(file);
  setStatus("");
}

fileInput.addEventListener("change", () => {
  handleFileSelection(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("drag-over");
  });
});

dropzone.addEventListener("drop", (event) => {
  const [droppedFile] = event.dataTransfer.files;
  handleFileSelection(droppedFile);
});

copyPayloadButton.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    setStatus("Select a file before copying payload JSON.", "error");
    return;
  }

  const metadata = createMetadataPayload(file);
  const payloadText = JSON.stringify(metadata, null, 2);

  try {
    await navigator.clipboard.writeText(payloadText);
    setStatus("Payload JSON copied to clipboard.", "success");
  } catch {
    setStatus("Could not copy payload JSON in this browser context.", "error");
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files[0];
  if (!file) {
    setStatus("Select a file before uploading.", "error");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Uploading...";
  setStatus("Sending file to n8n webhook...");

  try {
    const metadata = createMetadataPayload(file);
    const formData = new FormData();
    // formData.append("data", file, file.name);
    formData.append("file", file, file.name);
    formData.append("filename", metadata.filename);
    formData.append("size", String(metadata.size));
    formData.append("mimeType", metadata.mimeType);
    formData.append("extension", metadata.extension);
    formData.append("uploadedAt", metadata.uploadedAt);

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      body: formData,
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        responseText || `Upload failed with status ${response.status}`,
      );
    }

    setStatus("Upload successful. File was sent to n8n.", "success");
  } catch (error) {
    setStatus(`Upload failed: ${error.message}`, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Upload to n8n";
  }
});
