# n8n File Upload Page

Modern static page for uploading `.txt`, `.pdf`, and `.csv` files to:

`https://maarseek.app.n8n.cloud/webhook-test/upload`

## Run locally

From this folder:

```bash
python3 -m http.server 8080
```

Then open:

- http://localhost:8080

## Behavior

- Accepts only `.txt`, `.pdf`, `.csv`
- Sends the selected file as `multipart/form-data`
- Uses form field name: `file`
- Also sends metadata fields: `filename`, `size`, `mimeType`, `extension`, `uploadedAt`
- Shows success/error message after upload
