(function () {
  'use strict';

  const dropZone       = document.getElementById('drop-zone');
  const fileInput      = document.getElementById('file-input');
  const fileInfo       = document.getElementById('file-info');
  const uploadBtn      = document.getElementById('upload-btn');
  const uploadStatus   = document.getElementById('upload-status');
  const uploadError    = document.getElementById('upload-error');
  const progressWrap   = document.getElementById('progress-wrap');
  const progressBar    = document.getElementById('progress-bar');
  const progressText   = document.getElementById('progress-text');
  const stepsEl        = document.getElementById('steps');
  const uploadBox      = document.getElementById('upload-box');
  const resultBox      = document.getElementById('result');
  const resultUrl      = document.getElementById('result-url');
  const resultFilename = document.getElementById('result-filename');
  const expiryInfo     = document.getElementById('expiry-info');
  const copyBtn        = document.getElementById('copy-btn');
  const copyBtnLabel   = copyBtn.querySelector('span');
  const downloadLink   = document.getElementById('download-link');
  const newUploadBtn   = document.getElementById('new-upload-btn');
  const resultMsg      = document.getElementById('result-msg');

  // Ordered so index comparisons below (marking earlier steps "done") work.
  const STEP_ORDER = ['preparing', 'uploading', 'processing', 'completed'];

  let selectedFile = null;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) setFile(fileInput.files[0]);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
  });

  function setFile(file) {
    selectedFile = file;
    fileInfo.textContent = file.name + ' (' + formatBytes(file.size) + ')';
    fileInfo.classList.add('has-file');
    hideError();
  }

  uploadBtn.addEventListener('click', startUpload);

  function getSelectedHours() {
    const radio = document.querySelector('input[name="hours"]:checked');
    return radio ? radio.value : '1';
  }

  function startUpload() {
    hideError();

    if (!selectedFile) {
      showError('Please choose a file first.');
      return;
    }

    const MAX = 50 * 1024 * 1024;
    if (selectedFile.size > MAX) {
      showError('File is too large. Maximum size is 50 MB.');
      return;
    }

    if (selectedFile.size === 0) {
      showError('File is empty.');
      return;
    }

    setUploading(true);
    setStep('preparing', 'Preparing upload…', 0);

    // formData assembly + a fresh XHR is the real "preparing" work that
    // happens before a single byte goes over the wire.
    const hours = getSelectedHours();
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('hours', hours);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);

    // Fires the moment the browser starts sending bytes to the server —
    // this is the real transition out of "preparing".
    xhr.upload.addEventListener('loadstart', () => {
      setStep('uploading', 'Uploading… 0%', 0);
    });

    // Real, accurate progress straight from the browser's network layer —
    // not a simulated animation. e.loaded/e.total reflect actual bytes sent.
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setStep('uploading', 'Uploading… ' + pct + '%', pct);
      }
    });

    // All bytes have left the browser, but the server still needs to
    // validate, store the file in Supabase Storage, write the metadata
    // row, and build a response — that's genuine server-side processing
    // time, not a fake delay.
    xhr.upload.addEventListener('load', () => {
      setStep('processing', 'Processing…', 100);
    });

    xhr.addEventListener('load', () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        setUploading(false);
        showError('Unexpected server response.');
        return;
      }

      if (!data.ok || xhr.status >= 400) {
        setUploading(false);
        showError(data.error || 'Upload failed.');
        return;
      }

      setStep('completed', 'Completed', 100);
      setTimeout(() => {
        setUploading(false);
        showResult(data);
      }, 250);
    });

    xhr.addEventListener('error', () => {
      setUploading(false);
      showError('Network error. Please try again.');
    });

    xhr.addEventListener('abort', () => {
      setUploading(false);
      showError('Upload cancelled.');
    });

    xhr.send(formData);
  }

  function setStep(stepName, label, pct) {
    const idx = STEP_ORDER.indexOf(stepName);
    const nodes = stepsEl.querySelectorAll('.step');
    nodes.forEach((node) => {
      const nodeIdx = STEP_ORDER.indexOf(node.dataset.step);
      node.classList.remove('active', 'done');
      if (nodeIdx < idx) node.classList.add('done');
      else if (nodeIdx === idx) node.classList.add('active');
    });
    progressBar.style.width = pct + '%';
    progressText.textContent = label;
  }

  function setUploading(active) {
    uploadBtn.disabled = active;
    progressWrap.style.display = active ? 'block' : 'none';
    if (active) {
      uploadStatus.innerHTML = '<span class="spinner"></span>';
    } else {
      uploadStatus.innerHTML = '';
      const nodes = stepsEl.querySelectorAll('.step');
      nodes.forEach((node) => node.classList.remove('active', 'done'));
      progressBar.style.width = '0%';
    }
  }

  function showResult(data) {
    const fullUrl = window.location.origin + data.url;

    resultUrl.textContent = fullUrl;
    resultFilename.textContent = data.filename + ' (' + formatBytes(data.size) + ')';
    downloadLink.href = data.url;

    if (data.permanent) {
      expiryInfo.innerHTML = 'Expires: <strong>Never (permanent)</strong>';
    } else {
      const expiresDate = new Date(data.expiresAt);
      expiryInfo.innerHTML = 'Expires: <strong>' + formatExpiry(expiresDate) + '</strong>';
    }

    uploadBox.style.display = 'none';
    resultBox.style.display = 'block';
    hideResultMsg();
  }

  copyBtn.addEventListener('click', () => {
    const url = resultUrl.textContent;
    if (!url) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => flashCopy()).catch(() => fallbackCopy(url));
    } else {
      fallbackCopy(url);
    }
  });

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      flashCopy();
    } catch {
      showResultMsg('Could not copy. Please select and copy manually.', 'error');
    }
    document.body.removeChild(ta);
  }

  function flashCopy() {
    const orig = copyBtnLabel.textContent;
    copyBtnLabel.textContent = 'Copied!';
    copyBtn.disabled = true;
    setTimeout(() => {
      copyBtnLabel.textContent = orig;
      copyBtn.disabled = false;
    }, 1500);
  }

  // Note: there is deliberately no delete button or delete request anywhere
  // in this file. Files can only be removed automatically upon expiration
  // (enforced server-side in src/routes/file.js and swept by /cron/cleanup).

  newUploadBtn.addEventListener('click', resetForm);

  function resetForm() {
    selectedFile = null;

    fileInput.value = '';
    fileInfo.textContent = 'No file selected.';
    fileInfo.classList.remove('has-file');

    hideError();
    hideResultMsg();

    resultBox.style.display = 'none';
    uploadBox.style.display = 'block';

    progressWrap.style.display = 'none';
    progressBar.style.width = '0%';
    uploadBtn.disabled = false;
    uploadStatus.innerHTML = '';
  }

  function showError(msg) {
    uploadError.textContent = msg;
    uploadError.style.display = 'block';
  }

  function hideError() {
    uploadError.style.display = 'none';
    uploadError.textContent = '';
  }

  function showResultMsg(msg, type) {
    resultMsg.textContent = msg;
    resultMsg.className = 'msg ' + (type || 'error');
    resultMsg.style.display = 'block';
  }

  function hideResultMsg() {
    resultMsg.style.display = 'none';
    resultMsg.textContent = '';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function formatExpiry(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const d = date;
    return (
      d.getFullYear() + '-' +
      pad(d.getMonth() + 1) + '-' +
      pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' +
      pad(d.getMinutes()) + ' (local)'
    );
  }

})();
