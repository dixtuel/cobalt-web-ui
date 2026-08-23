document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('urlInput');
  const pasteBtn = document.getElementById('pasteBtn');
  const submitBtn = document.getElementById('submitBtn');
  const downloadForm = document.getElementById('downloadForm');
  const resultContainer = document.getElementById('resultContainer');
  const backendStatus = document.getElementById('backendStatus');
  const statusDot = document.querySelector('.status-dot');
  
  const modeVideo = document.getElementById('modeVideo');
  const modePhoto = document.getElementById('modePhoto');
  const modeAudio = document.getElementById('modeAudio');
  
  const qualityWrapper = document.getElementById('qualityWrapper');
  const qualitySelect = document.getElementById('qualitySelect');
  const photoQualityWrapper = document.getElementById('photoQualityWrapper');
  const audioFormatWrapper = document.getElementById('audioFormatWrapper');
  const audioFormatSelect = document.getElementById('audioFormatSelect');
  const codecWrapper = document.getElementById('codecWrapper');
  const codecSelect = document.getElementById('codecSelect');
  const toast = document.getElementById('toast');

  let currentMode = 'auto'; // 'auto' (video), 'photo', or 'audio'

  // Mode buttons
  function setMode(mode) {
    currentMode = mode;
    modeVideo.classList.toggle('active', mode === 'auto');
    modePhoto.classList.toggle('active', mode === 'photo');
    modeAudio.classList.toggle('active', mode === 'audio');

    if (mode === 'auto') {
      qualityWrapper.style.display = 'flex';
      photoQualityWrapper.style.display = 'none';
      audioFormatWrapper.style.display = 'none';
      codecWrapper.style.display = 'flex';
    } else if (mode === 'photo') {
      qualityWrapper.style.display = 'none';
      photoQualityWrapper.style.display = 'flex';
      audioFormatWrapper.style.display = 'none';
      codecWrapper.style.display = 'none';
    } else if (mode === 'audio') {
      qualityWrapper.style.display = 'none';
      photoQualityWrapper.style.display = 'none';
      audioFormatWrapper.style.display = 'flex';
      codecWrapper.style.display = 'none';
    }
  }

  modeVideo.addEventListener('click', () => setMode('auto'));
  modePhoto.addEventListener('click', () => setMode('photo'));
  modeAudio.addEventListener('click', () => setMode('audio'));

  // Paste button
  pasteBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          urlInput.value = text.trim();
          showToast('Bağlantı panodan yapıştırıldı', 'success');
        }
      } else {
        urlInput.focus();
        showToast('Lütfen bağlantıyı yapıştırın', '');
      }
    } catch (err) {
      urlInput.focus();
    }
  });

  // Toast Helper
  let toastTimer = null;
  function showToast(message, type = '') {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    toastTimer = setTimeout(() => {
      toast.className = 'toast';
    }, 4500);
  }

  // Health check
  async function checkBackend() {
    try {
      const res = await fetch('/api/', { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.cobalt) {
          backendStatus.textContent = `v${data.cobalt.version || '11'}`;
          statusDot.style.backgroundColor = '#10b981';
          return;
        }
      }
      backendStatus.textContent = 'Aktif';
    } catch (err) {
      backendStatus.textContent = 'Bağlantı Bekleniyor';
      statusDot.style.backgroundColor = '#f59e0b';
    }
  }
  checkBackend();

  // URL normalizer: Creates clean download endpoint for iOS Safari & browsers
  function buildDownloadUrl(rawUrl, filename) {
    if (!rawUrl) return '';

    // If already a Cobalt tunnel link
    if (rawUrl.includes('/tunnel?')) {
      try {
        const parsed = new URL(rawUrl, window.location.origin);
        return `${window.location.origin}${parsed.pathname}${parsed.search}`;
      } catch {
        return rawUrl;
      }
    }

    // Direct CDN / External stream proxy
    return `/download?url=${encodeURIComponent(rawUrl)}&filename=${encodeURIComponent(filename || 'download.mp4')}`;
  }

  // Trigger download (forces native iOS Safari attachment prompt)
  function triggerDownload(url, filename) {
    const finalUrl = buildDownloadUrl(url, filename);
    const a = document.createElement('a');
    a.href = finalUrl;
    if (filename) a.download = filename;
    a.target = '_self';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Multi-item sequential download
  window.downloadAllItems = async function(items) {
    showToast(`${items.length} adet medya indiriliyor...`, 'success');
    for (let i = 0; i < items.length; i++) {
      triggerDownload(items[i].url, items[i].filename || `media_${i + 1}.jpg`);
      await new Promise(r => setTimeout(r, 600));
    }
  };

  function isTikTokUrl(url) {
    return /(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com)/i.test(url);
  }

  // Direct TikTok API Handler (Bypasses Datacenter WAF)
  async function downloadTikTokDirect(rawUrl) {
    const formData = new URLSearchParams();
    formData.append('url', rawUrl);
    formData.append('hd', '1');

    const res = await fetch('/tiktok-api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });

    const data = await res.json();

    if (data.code !== 0 || !data.data) {
      throw new Error(data.msg || 'TikTok içeriği çözülemedi.');
    }

    const tData = data.data;
    const author = tData.author?.unique_id || 'tiktok_user';
    const title = (tData.title || 'tiktok_media').replace(/[^\w\s\u00C0-\u017F-]/gi, '').slice(0, 50).trim();

    // Check if photo slideshow / album
    if (tData.images && Array.isArray(tData.images) && tData.images.length > 0) {
      const photoItems = tData.images.map((imgUrl, idx) => ({
        url: imgUrl,
        filename: `tiktok_${author}_photo_${idx + 1}.jpg`,
        thumb: imgUrl,
        type: 'photo'
      }));

      renderPicker(photoItems, `TikTok Fotoğraf Albümü (${photoItems.length} Fotoğraf)`);
      showToast(`${photoItems.length} fotoğraf bulundu!`, 'success');
      return;
    }

    // Single video or audio
    let rawDownloadUrl = currentMode === 'audio' ? (tData.music || tData.play) : (tData.hdplay || tData.play);
    let extension = currentMode === 'audio' ? 'mp3' : 'mp4';
    let filename = `tiktok_${author}_${title || tData.id}.${extension}`;

    renderSingleResult(rawDownloadUrl, filename, `TikTok (Filigransız HD ${extension.toUpperCase()})`);
    triggerDownload(rawDownloadUrl, filename);
    showToast('TikTok indirmesi başlatıldı!', 'success');
  }

  // Render helpers
  function renderSingleResult(url, filename, tag = 'İndirme Hazır') {
    const finalUrl = buildDownloadUrl(url, filename);

    resultContainer.innerHTML = `
      <div class="result-card-single">
        <div class="result-info">
          <span class="result-filename" title="${filename}">${filename}</span>
          <span class="result-tag">✓ ${tag}</span>
        </div>
        <div class="result-actions">
          <a href="${finalUrl}" class="btn-download-action" download="${filename}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>İndir</span>
          </a>
        </div>
      </div>
    `;
    resultContainer.style.display = 'block';
  }

  function renderPicker(items, titleText = 'Galeri / Çoklu Medya') {
    window._lastPickerItems = items;
    
    let itemsHtml = items.map((item, idx) => {
      const itemFilename = item.filename || `foto_${idx + 1}.jpg`;
      const finalItemUrl = buildDownloadUrl(item.url, itemFilename);

      return `
        <div class="picker-item">
          <span class="picker-badge">#${idx + 1}</span>
          <img src="${item.thumb || item.url}" alt="Önizleme ${idx + 1}" loading="lazy">
          <div class="picker-item-action">
            <a href="${finalItemUrl}" download="${itemFilename}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>İndir</span>
            </a>
          </div>
        </div>
      `;
    }).join('');

    resultContainer.innerHTML = `
      <div class="gallery-header">
        <div class="gallery-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <span>${titleText}</span>
        </div>
        <button type="button" class="btn-download-all" onclick="window.downloadAllItems(window._lastPickerItems)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Tümünü İndir (${items.length})</span>
        </button>
      </div>
      <div class="picker-grid">${itemsHtml}</div>
    `;
    resultContainer.style.display = 'block';
  }

  // Handle Form Submit
  downloadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) {
      showToast('Lütfen geçerli bir URL girin', 'error');
      return;
    }

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    resultContainer.style.display = 'none';
    resultContainer.innerHTML = '';

    // Direct high-res TikTok handler
    if (isTikTokUrl(rawUrl)) {
      try {
        await downloadTikTokDirect(rawUrl);
        return;
      } catch (err) {
        console.warn('Direct TikTok resolver error, falling back to Cobalt:', err);
      } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
      }
    }

    const payload = {
      url: rawUrl,
      downloadMode: currentMode === 'photo' ? 'auto' : currentMode,
      videoQuality: qualitySelect.value,
      audioFormat: audioFormatSelect.value,
      youtubeVideoCodec: codecSelect.value
    };

    try {
      const res = await fetch('/', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok || data.status === 'error') {
        if (isTikTokUrl(rawUrl)) {
          await downloadTikTokDirect(rawUrl);
          return;
        }

        const errCode = data.error?.code || 'Bilinmeyen hata';
        const errService = data.error?.context?.service || '';
        let errorMsg = `İndirme başarısız (${errCode})`;
        
        if (errCode === 'error.api.fetch.fail') {
          errorMsg = `${errService ? errService.toUpperCase() + ': ' : ''}İçerik çekilemedi veya bot korumasına takıldı.`;
        } else if (errCode === 'error.api.content.private') {
          errorMsg = 'Bu içerik gizli veya oturum gerektiriyor.';
        } else if (errCode === 'error.api.link.invalid') {
          errorMsg = 'Geçersiz veya desteklenmeyen bağlantı formatı.';
        }

        showToast(errorMsg, 'error');
        return;
      }

      // Single file download
      if (data.status === 'tunnel' || data.status === 'redirect') {
        const downloadUrl = data.url;
        const filename = data.filename || 'media_download';

        renderSingleResult(downloadUrl, filename, 'İndirme Hazır');
        triggerDownload(downloadUrl, filename);
        showToast('İndirme başlatıldı!', 'success');

      } else if (data.status === 'picker' && Array.isArray(data.picker)) {
        // Multi-photo / carousel (Instagram slides, Twitter images, etc.)
        const pickerItems = data.picker.map((item, idx) => ({
          url: item.url,
          thumb: item.thumb || item.url,
          filename: `photo_${idx + 1}.jpg`,
          type: item.type || 'photo'
        }));

        renderPicker(pickerItems, `Fotoğraf / Galeri (${pickerItems.length} Öğe)`);
        showToast(`${pickerItems.length} adet medya bulundu!`, 'success');
      }

    } catch (err) {
      showToast('İndirme hatası: ' + err.message, 'error');
    } finally {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  });
});
